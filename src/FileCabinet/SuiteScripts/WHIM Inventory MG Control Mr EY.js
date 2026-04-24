/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/runtime', 'N/record', 'N/log'], (runtime, record, log) => {
    const WHRBIN = 301
    const WHSBIN = 302
    const HOLD_STATUS = 4
    const GOOD_STATUS = 1
    const LOCATION = 1

    function getInputData() {
        const script = runtime.getCurrentScript()
        const action = script.getParameter({ name: 'custscript_action' })
        const dataStr = script.getParameter({ name: 'custscript_data' })

        if (!action) {
            log.error({ title: 'Missing action', details: 'custscript_action is empty' })
            return []
        }

        if (!dataStr) {
            log.error({ title: 'Missing data', details: 'custscript_data is empty' })
            return []
        }

        let lines = []
        try {
            lines = JSON.parse(dataStr)
        } catch (e) {
            log.error({ title: 'Invalid JSON in custscript_data', details: e.message || String(e) })
            return []
        }

        if (!Array.isArray(lines)) {
            log.error({ title: 'Invalid data type', details: 'custscript_data must be an array' })
            return []
        }

        return lines.map(line => ({ ...line, action }))
    }

    function map(context) {
        const line = JSON.parse(context.value)
        const action = line.action

        if (action === 'soQCRelease') {
            if (!line.soId && line.soId !== 0) return
            context.write({
                key: String(line.soId),
                value: JSON.stringify(line)
            })
            return
        }

        if (action === 'releasing') {
            const item = Number(line.item)
            const fromBin = Number(line.fromBin || WHSBIN)
            const toBin = Number(line.toBin || WHRBIN)
            const fromStatus = Number(line.fromStatus || GOOD_STATUS)
            const toStatus = Number(line.toStatus || HOLD_STATUS)

            if (!item || !line.qty) return

            context.write({
                key: [item, fromBin, toBin, fromStatus, toStatus].join('|'),
                value: JSON.stringify({
                    ...line,
                    item,
                    fromBin,
                    toBin,
                    fromStatus,
                    toStatus
                })
            })
            return
        }

        log.error({
            title: 'Unknown action in map',
            details: action
        })
    }

    function reduce(context) {
        const lines = context.values.map(v => JSON.parse(v))
        if (!lines.length) return

        const action = lines[0].action

        try {
            if (action === 'soQCRelease') {
                handleQCRelease(context.key, lines)
            } else if (action === 'releasing') {
                handleBinTransfer(lines)
            } else {
                log.error({
                    title: 'Unknown action in reduce',
                    details: action
                })
                return
            }

            log.audit({
                title: 'Reduce complete',
                details: `${action} key ${context.key} lines ${lines.length}`
            })
        } catch (e) {
            log.error({
                title: `Reduce failed for key ${context.key}`,
                details: e.message || String(e)
            })
            throw e
        }
    }

    function handleQCRelease(soId, lines) {
        const rec = record.load({
            type: record.Type.SALES_ORDER,
            id: soId
        })

        lines.forEach(({ lineIndex, confirmQty }) => {
            const index = Number(lineIndex)
            const qtyToAdd = Number(confirmQty) || 0
            if (Number.isNaN(index) || qtyToAdd <= 0) return

            const orderedQty = Number(rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: index
            })) || 0

            const alreadyPrepared = Number(rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_qty_prepared',
                line: index
            })) || 0

            const newPreparedQty = alreadyPrepared + qtyToAdd

            let stage = 'pending'
            if (newPreparedQty > 0 && newPreparedQty < orderedQty) {
                stage = 'partial'
            } else if (newPreparedQty >= orderedQty && orderedQty > 0) {
                stage = 'prepared'
            }

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_qty_prepared',
                line: index,
                value: newPreparedQty
            })

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_prep_stage',
                line: index,
                value: stage
            })
        })

        rec.save()
    }

    function handleBinTransfer(lines) {
        const transfer = record.create({
            type: record.Type.BIN_TRANSFER,
            isDynamic: true
        })

        transfer.setValue({ fieldId: 'location', value: LOCATION })
        transfer.setValue({ fieldId: 'transferlocation', value: LOCATION })

        lines.forEach(line => {
            const item = Number(line.item)
            const qty = Number(line.qty)
            if (!item || qty <= 0) return

            const fromBin = Number(line.fromBin || WHSBIN)
            const toBin = Number(line.toBin || WHRBIN)
            const fromStatus = Number(line.fromStatus || GOOD_STATUS)
            const toStatus = Number(line.toStatus || HOLD_STATUS)

            transfer.selectNewLine({ sublistId: 'inventory' })

            transfer.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'item',
                value: item
            })

            transfer.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'quantity',
                value: qty
            })

            const invDetail = transfer.getCurrentSublistSubrecord({
                sublistId: 'inventory',
                fieldId: 'inventorydetail'
            })

            invDetail.selectNewLine({ sublistId: 'inventoryassignment' })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'binnumber',
                value: fromBin
            })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'inventorystatus',
                value: fromStatus
            })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'tobinnumber',
                value: toBin
            })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'toinventorystatus',
                value: toStatus
            })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                value: qty
            })

            invDetail.commitLine({ sublistId: 'inventoryassignment' })
            transfer.commitLine({ sublistId: 'inventory' })
        })

        const transferId = transfer.save()
        log.audit({ title: 'Bin transfer created', details: `ID ${transferId}` })
    }

    function summarize(summary) {
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error({ title: `Map error ${key}`, details: error })
            return true
        })

        summary.reduceSummary.errors.iterator().each((key, error) => {
            log.error({ title: `Reduce error ${key}`, details: error })
            return true
        })

        log.audit({
            title: 'MR finished',
            details: `Usage ${summary.usage}, Yields ${summary.yields}, Concurrency ${summary.concurrency}`
        })
    }

    return { getInputData, map, reduce, summarize }

})