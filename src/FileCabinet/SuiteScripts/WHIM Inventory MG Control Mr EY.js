/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */

define(['N/runtime', 'N/record', 'N/log', 'N/search'], (runtime, record, log, search) => {
    const WHRBIN = 301
    const WHSBIN = 302
    const HOLD_STATUS = 4
    const GOOD_STATUS = 1
    const QC_STATUS = 3
    const LOCATION = 1

    function getInputData() {
        const script = runtime.getCurrentScript()
        const action = script.getParameter({ name: 'custscript_action' })
        const dataStr = script.getParameter({ name: 'custscript_data' })

        if (!action) {
            log.error({
                title: 'Missing action',
                details: 'custscript_action is empty'
            })
            return []
        }

        if (!dataStr) {
            log.error({
                title: 'Missing data',
                details: 'custscript_data is empty'
            })
            return []
        }

        let lines = []
        try {
            lines = JSON.parse(dataStr)
        } catch (e) {
            log.error({
                title: 'Invalid JSON in custscript_data',
                details: e.message || String(e)
            })
            return []
        }

        if (!Array.isArray(lines)) {
            log.error({
                title: 'Invalid data type',
                details: 'custscript_data must be an array'
            })
            return []
        }

        return lines.map(line => ({ ...line, action }))
    }

    function map(context) {
        const line = JSON.parse(context.value)
        const action = line.action

        if (action === 'soQCRelease') {
            const soId = Number(line.soId)
            const confirmQty = Number(line.confirmQty) || 0
            const item = Number(line.item) || 0

            if (!soId || confirmQty <= 0 || line.lineIndex === null || line.lineIndex === undefined || line.lineIndex === '') {
                log.error({
                    title: 'Invalid soQCRelease map payload',
                    details: JSON.stringify(line)
                })
                return
            }

            log.debug({
                title: 'Map SO-QC-Release',
                details: `SO ID ${soId} Line ${JSON.stringify(line)} with action ${action}`
            })

            context.write({
                key: `so|${soId}`,
                value: JSON.stringify({ ...line, soId, confirmQty })
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
        const key = String(context.key)

        try {
            if (key.indexOf('so|') === 0 || action === 'soQCRelease') {
                const soId = key.indexOf('so|') === 0 ? Number(key.split('|')[1]) : Number(context.key)
                handleQCRelease(soId, lines)
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
                details: `${action} key ${key} lines ${lines.length}`
            })
        } catch (e) {
            log.error({
                title: `Reduce failed for key ${context.key}`,
                details: e.message || String(e)
            })
            throw e
        }
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


    function handleStatusChange(lines) {
        const QC_STATUS = 3

        const statusChange = record.create({
            type: record.Type.INVENTORY_STATUS_CHANGE,
            isDynamic: true
        })

        statusChange.setValue({ fieldId: 'location', value: LOCATION })

        lines.forEach(line => {
            const item = Number(line.item)
            const qty = Number(line.qty)
            if (!item || qty <= 0) return

            const fromStatus = Number(line.fromStatus || QC_STATUS)
            const toStatus = Number(line.toStatus || GOOD_STATUS)
            const bin = Number(line.bin || WHSBIN)

            statusChange.selectNewLine({ sublistId: 'inventory' })

            statusChange.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'item',
                value: item
            })

            statusChange.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'adjustqtyby',
                value: qty
            })

            const invDetail = statusChange.getCurrentSublistSubrecord({
                sublistId: 'inventory',
                fieldId: 'inventorydetail'
            })

            invDetail.selectNewLine({ sublistId: 'inventoryassignment' })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'binnumber',
                value: bin
            })

            invDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'inventorystatus',
                value: fromStatus
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
            statusChange.commitLine({ sublistId: 'inventory' })
        })

        const statusChangeId = statusChange.save()
        log.audit({ title: 'Inventory status change created', details: `ID ${statusChangeId}` })
    }

    function handleQCRelease(soId, lines) {
        

        // Step 1 bin transfer first (WHRBIN Hold > WHSBIN QC), expanding kits to components
        try {
            const binLines = buildBinTransferLines(lines)
            if (binLines.length > 0) {
                handleBinTransfer(binLines)
            } else {
                log.audit({ title: 'No bin transfer lines', details: `SO ${soId} - all items may be non-inventory` })
            }
        } catch (e) {
            log.error({
                title: `Bin transfer failed for SO ${soId} - fulfillment will NOT be created`,
                details: e.message || String(e)
            })
            return
        }

        //step 2 update SO line stages and prepared qtys, and create fulfillment with prepared qtys
         const selectedQtyByLineKey = buildItemStages(soId, lines)

        // Step 3 fulfillment only after bin transfer succeeds
        createPackedFulfillment(soId, selectedQtyByLineKey)
    }

    function buildItemStages(soId, lines) {
        if (!soId) {
            log.error({ title: 'Invalid SO id in handleQCRelease', details: soId })
            return
        }

        const rec = record.load({
            type: record.Type.SALES_ORDER,
            id: soId
        })

        const lineKeyToIndex = buildLineKeyToIndexMap(rec)
        const selectedQtyByLineKey = {}
        let hasSoChanges = false

        lines.forEach(({ lineIndex, confirmQty }) => {
            const lineUniqueKey = String(lineIndex)
            const index = lineKeyToIndex[lineUniqueKey]
            const qtyToAdd = Number(confirmQty) || 0

            if (index === undefined || qtyToAdd <= 0) {
                log.error({
                    title: 'QC line not resolved',
                    details: `[SO ${soId} lineUniqueKey ${lineUniqueKey} confirmQty ${confirmQty}]`
                })
                return
            }

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

            const ro = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_release_order',
                line: index
            })

            if (ro === false) return

            const remainingToPrepare = Math.max(orderedQty - alreadyPrepared, 0)
            const appliedQty = Math.min(qtyToAdd, remainingToPrepare)
            if (appliedQty <= 0) return

            const finalPreparedQty = alreadyPrepared + appliedQty

            let stage = 'pending'
            if (finalPreparedQty > 0 && finalPreparedQty < orderedQty) stage = 'partial'
            if (orderedQty > 0 && finalPreparedQty >= orderedQty) stage = 'prepared'

            selectedQtyByLineKey[lineUniqueKey] = (selectedQtyByLineKey[lineUniqueKey] || 0) + appliedQty

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'commitinventory',
                value: 1,
                line: index
            })

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_qty_prepared',
                line: index,
                value: finalPreparedQty
            })

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_prep_stage',
                line: index,
                value: stage
            })

            log.debug({
                title: 'QC line updated',
                details: `[SO ${soId} key ${lineUniqueKey} idx ${index} ordered ${orderedQty} applied ${appliedQty} newPrepared ${finalPreparedQty} stage ${stage}]`
            })

            hasSoChanges = true
        })

        if (hasSoChanges) {
            rec.save()
            log.audit({ title: 'SO updated', details: `SO ${soId} prepared fields saved` })
        }

        return selectedQtyByLineKey
    }

    function buildBinTransferLines(lines) {
        const aggregated = {}

        lines.forEach(({ item, itemType, confirmQty }) => {
            const itemId = Number(item) || 0
            const qty = Number(confirmQty) || 0
            if (!itemId || qty <= 0) return

            const isKit = String(itemType || '').toLowerCase() === 'kit'

            let components = []
            if (isKit) {
                components = getKitComponents(itemId, qty)
                if (!components.length) {
                    log.error({
                        title: 'Kit has no inventory components',
                        details: `Kit item ${itemId} qty ${qty}`
                    })
                }
            } else {
                components = [{ item: itemId, qty }]
            }

            components.forEach(({ item: compId, qty: compQty }) => {
                const key = [compId, WHRBIN, WHSBIN, HOLD_STATUS, QC_STATUS].join('|')
                if (!aggregated[key]) {
                    aggregated[key] = { item: compId, qty: 0, fromBin: WHRBIN, toBin: WHSBIN, fromStatus: HOLD_STATUS, toStatus: QC_STATUS }
                }
                aggregated[key].qty += compQty
            })
        })

        return Object.values(aggregated).filter(l => l.item && l.qty > 0)
    }

    function getKitComponents(kitItemId, kitQty) {
        const components = []
        try {
            search.create({
                type: 'item',
                filters: [
                    ['internalid', 'anyof', kitItemId],
                    'AND',
                    ['type', 'anyof', 'Kit'],
                ],
                columns: ['internalid', 'memberquantity',
                    search.createColumn({
                        name: 'internalid',
                        join: 'memberitem'
                    }),
                    search.createColumn({
                        name: 'type',
                        join: 'memberitem'
                    }),
                    search.createColumn({ name: 'memberitem' })
                ]
            }).run().each(r => {
                const memberId = Number(r.getValue({
                    name: 'internalid',
                    join: 'memberitem'
                }))
                const memberQty = Number(r.getValue('memberquantity'))
                const memberType = r.getValue({ name: 'type', join: 'memberitem' })
                if (memberId > 0) {
                    components.push({ item: memberId, qty: memberQty * kitQty, memberType })
                }
                return true
            })
            log.debug({
                title: 'Kit components resolved',
                details: `Kit ${kitItemId} x${kitQty}: ${JSON.stringify(components)}`
            })
        } catch (e) {
            log.error({
                title: `Failed to resolve kit components for item ${kitItemId}`,
                details: e.message || String(e)
            })
        }
        return components
    }

    function createPackedFulfillment(soId, selectedQtyByLineKey) {
        const selectedLineKeys = Object.keys(selectedQtyByLineKey)
        if (!selectedLineKeys.length) {
            log.audit({
                title: 'No selected lines for fulfillment',
                details: `SO ${soId}`
            })
            return
        }

        const fulfillment = record.transform({
            fromType: record.Type.SALES_ORDER,
            fromId: soId,
            toType: record.Type.ITEM_FULFILLMENT,
            isDynamic: false
        })

        fulfillment.setValue({ fieldId: 'shipstatus', value: 'B' })
        //fulfillment.setValue({ fieldId: 'custbody_viso_shipping_carrier', value: 1 })
        //fulfillment.setValue({ fieldId: 'custbody_tracking_number', value: 'TBD' })
        const today = new Date()
        //fulfillment.setValue({ fieldId: 'custbody_ship_delivery_date', value: today }) // to be revised
        fulfillment.setValue({ fieldId: 'custbody_packaged_on', value: today })
        const lineKeyToIndex = buildLineKeyToIndexMap(fulfillment)
        let hasFulfillmentLines = false

        selectedLineKeys.forEach(lineKey => {
            const index = lineKeyToIndex[String(lineKey)]
            const requestedQty = Number(selectedQtyByLineKey[lineKey]) || 0
            if (index === undefined || requestedQty <= 0) return

            const defaultQty = Number(fulfillment.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: index
            })) || 0

            const fulfillQty = defaultQty > 0 ? Math.min(requestedQty, defaultQty) : requestedQty
            if (fulfillQty <= 0) return

            fulfillment.setSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                line: index,
                value: true
            })

            fulfillment.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: index,
                value: fulfillQty
            })

            hasFulfillmentLines = true
        })

        const lineCount = fulfillment.getLineCount({ sublistId: 'item' }) || 0
        for (let i = 0; i < lineCount; i++) {
            const lineKey = String(fulfillment.getSublistValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                line: i
            }) || '')

            if (!selectedQtyByLineKey[lineKey]) {
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: false
                })
            }
        }

        if (!hasFulfillmentLines) {
            log.audit({
                title: 'No valid fulfillment quantities',
                details: `SO ${soId}`
            })
            return
        }

        const fulfillmentId = fulfillment.save({
            ignoreMandatoryFields: true
        })

        log.audit({
            title: 'Packed fulfillment created',
            details: `SO ${soId} IF ${fulfillmentId}`
        })
    }

    function handleConsolidatedBinTransfer(lines) {
        if (!lines.length) return

        const aggregated = {}

        lines.forEach(line => {
            const item = Number(line.item)
            const qty = Number(line.qty) || 0
            const fromBin = Number(line.fromBin || WHRBIN)
            const toBin = Number(line.toBin || WHSBIN)
            const fromStatus = Number(line.fromStatus || HOLD_STATUS)
            const toStatus = Number(line.toStatus || QC_STATUS)

            if (!item || qty <= 0) return

            const key = [item, fromBin, toBin, fromStatus, toStatus].join('|')
            if (!aggregated[key]) {
                aggregated[key] = {
                    item,
                    qty: 0,
                    fromBin,
                    toBin,
                    fromStatus,
                    toStatus
                }
            }

            aggregated[key].qty += qty
        })

        const transferLines = Object.keys(aggregated).map(key => aggregated[key])
        if (!transferLines.length) return

        handleBinTransfer(transferLines)
    }

    function buildLineKeyToIndexMap(rec) {
        const map = {}
        const lineCount = rec.getLineCount({ sublistId: 'item' }) || 0

        for (let i = 0; i < lineCount; i++) {
            const key = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                line: i
            })

            if (key !== null && key !== undefined && key !== '') {
                map[String(key)] = i
            }
        }

        return map
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