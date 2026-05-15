/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */

define(['N/runtime', 'N/record', 'N/log', 'N/search'], (runtime, record, log, search) => {
    const WHRBIN = 301
    const HOLD_STATUS = 4
    const GOOD_STATUS = 1
    const LOCATION = 1
    const ORDERTYPE = 13

    function getInputData() {
        const script = runtime.getCurrentScript()
        const soId = Number(script.getParameter({ name: 'custscript_datasoid' }))

        if (!soId) {
            log.error({
                title: 'Missing data'
            })
            return
        }
        return [soId]
    }

    function map(context) {
        const soId = Number(JSON.parse(context.value))
        if (!soId) return

        context.write({
            key: String(soId),
            value: JSON.stringify({ soId })
        })
    }

    function reduce(context) {
        const soId = Number(context.key)
        if (!soId) return

        log.debug({
            title: 'Reduce SO',
            details: `SO ${soId}`
        })

        handleConsolidatedQCRelease(soId)
    }

    function handleStatusChange(lines, memoText) {

        const statusChange = record.create({
            type: record.Type.INVENTORY_STATUS_CHANGE,
            isDynamic: false
        })

        statusChange.setValue({ fieldId: 'location', value: LOCATION })
        statusChange.setValue({ fieldId: 'previousstatus', value: HOLD_STATUS })
        statusChange.setValue({ fieldId: 'revisedstatus', value: GOOD_STATUS })
        if (memoText) {
            statusChange.setValue({ fieldId: 'memo', value: memoText })
        }

        log.debug('step 2', { title: 'Handle Status Change', details: memoText, lines: lines })

        lines.forEach((line, invLine) => {
            const item = Number(line.item)
            const qty = Number(line.qty)
            if (!item || qty <= 0) return

            const bin = Number(line.bin || WHRBIN)

            statusChange.insertLine({
                sublistId: 'inventory',
                line: invLine
            })

            statusChange.setSublistValue({
                sublistId: 'inventory',
                fieldId: 'item',
                line: invLine,
                value: item
            })

            statusChange.setSublistValue({
                sublistId: 'inventory',
                fieldId: 'quantity',
                line: invLine,
                value: qty
            })

            const invDetail = statusChange.getSublistSubrecord({
                sublistId: 'inventory',
                fieldId: 'inventorydetail',
                line: invLine
            })

            invDetail.insertLine({
                sublistId: 'inventoryassignment',
                line: 0
            })

            invDetail.setSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'binnumber',
                line: 0,
                value: bin
            })

            invDetail.setSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                line: 0,
                value: qty
            })
        })

        const statusChangeId = statusChange.save()
        log.debug({ title: 'Inventory status change created', details: `ID ${statusChangeId}` })
    }

    function handleConsolidatedQCRelease(soId) {

        const salesOrder = record.load({
            type: record.Type.SALES_ORDER,
            id: soId,
            isDynamic: false
        })

        const tranId = salesOrder.getText({ fieldId: 'tranid' })
        const orderType = Number(salesOrder.getValue({ fieldId: 'ordertype' }))
        if (orderType !== ORDERTYPE) {
            log.debug({ title: 'Skipping SO by order type', details: `SO ${soId} ordertype ${orderType}` })
            return
        }

        const items = collectEligibleSoItems(salesOrder)
        if (!items.length) {
            log.debug({ title: 'No eligible items for SO', details: `SO ${soId}` })
            return
        }

        /*         const memo = 'Items made available for ' + tranId
        
                // Step 1: consolidated inventory status change for eligible items
                try {
                    const statusLines = buildStatusChangeLines(items)
                    if (statusLines.length > 0) {
                        handleStatusChange(statusLines, memo)
                    } else {
                        log.debug({ title: 'No status change lines for SO', details: `SO ${soId}` })
                    }
                } catch (e) {
                    log.error({
                        title: `Status change failed for SO ${soId} - fulfillment will NOT be created`,
                        details: e.message || String(e)
                    })
                    return
                }
        
                // Step 2: set SO lines to Available Qty commit mode and save SO
                try {
                    //   updateSoCommitInventory(salesOrder, items)
                } catch (e) {
                    log.error({
                        title: `Failed to update commit inventory for SO ${soId}`,
                        details: e.message || String(e)
                    })
                    return
                } */

        // Step 3: create item fulfillment for the SO
        createPackedFulfillment(soId, items)
    }

    function collectEligibleSoItems(salesOrder) {
        const items = []
        const lineCount = salesOrder.getLineCount({ sublistId: 'item' }) || 0
        const isReleased = salesOrder.getValue({ fieldId: 'custbody_buy_and_sell' })

        if (!isReleased) return
        for (let i = 0; i < lineCount; i++) {
            const itemType = String(salesOrder.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            }) || '')

            if (itemType !== 'InvtPart' && itemType !== 'Kit') continue

            const itemId = Number(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }))
            const itemText = salesOrder.getSublistText({ sublistId: 'item', fieldId: 'item', line: i })
            const qtyOrder = Number(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }))
            const qtyFulfilled = salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: i })
            const qtyCommitted = salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantitycommitted', line: i })
            const qtyAvailable = salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantityavailable', line: i })
            const commitInventory = salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'commitinventory', line: i })
            const lineUniqueKey = String(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'lineuniquekey', line: i }))
            const qtyRemaining = Math.max(qtyOrder - qtyFulfilled, 0)

            if (!itemId || !itemText || qtyRemaining <= 0 || !lineUniqueKey) continue
            //if (qtyAvailable === qtyOrder) continue
            items.push({
                item: itemText,
                itemId,
                itemType,
                qtyOrder,
                qtyFulfilled,
                qtyCommitted,
                qtyRemaining,
                commitInventory,
                lineUniqueKey
            })
        }
        return items
    }

    function updateSoCommitInventory(salesOrder, items) {
        const lineKeyToIndex = buildLineKeyToIndexMap(salesOrder)
        let hasChanges = false

        items.forEach(({ lineUniqueKey }) => {
            const index = lineKeyToIndex[String(lineUniqueKey)]
            if (index === undefined) return

            salesOrder.setSublistValue({
                sublistId: 'item',
                fieldId: 'commitinventory',
                line: index,
                value: 1
            })
            hasChanges = true
        })

        if (hasChanges) {
            salesOrder.save()
            log.debug({ title: 'SO commit inventory updated', details: `SO ${salesOrder.id}` })
        }
    }

    function buildStatusChangeLines(lines) {
        const aggregated = {}

        lines.forEach(({ itemId, itemType, qtyRemaining }) => {
            const inventoryItemId = Number(itemId)
            const qty = Number(qtyRemaining)
            if (!inventoryItemId || qty <= 0) return

            const isKit = String(itemType || '').toLowerCase() === 'kit'

            let components = []
            if (isKit) {
                components = getKitComponents(inventoryItemId, qty)
                if (!components.length) {
                    log.error({
                        title: 'Kit has no inventory components',
                        details: `Kit item ${inventoryItemId} qty ${qty}`
                    })
                }
            } else {
                components = [{ item: inventoryItemId, qty }]
            }

            components.forEach(({ item: compId, qty: compQty }) => {
                const key = [compId, WHRBIN, HOLD_STATUS, GOOD_STATUS].join('|')
                if (!aggregated[key]) {
                    aggregated[key] = {
                        item: compId,
                        qty: 0,
                        bin: WHRBIN,
                        fromStatus: HOLD_STATUS,
                        toStatus: GOOD_STATUS
                    }
                }
                aggregated[key].qty += compQty
            })
        })
        log.debug({
            title: 'buildStatusChangeLines',
            details: `return: ${Object.values(aggregated).filter(l => l.item && l.qty > 0)}`
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

    function createPackedFulfillment(soId, items) {
        const selectedItems = Array.isArray(items) ? items.filter(item => item && item.lineUniqueKey && Number(item.qtyRemaining) > 0) : []
        if (!selectedItems.length) {
            log.debug({
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
        //fulfillment.setValue({ fieldId: 'custbody_ship_delivery_date', value: today })
        //fulfillment.setValue({ fieldId: 'custbody_packaged_on', value: today })
        //const lineKeyToIndex = buildLineKeyToIndexMap(fulfillment)
        const selectedQtyByItem = {}
        selectedItems.forEach(item => {
            selectedQtyByItem[String(item.itemId)] = Number(item.qtyRemaining) 
        })
        const selectedLineKeys = Object.keys(selectedQtyByItem)
        let hasFulfillmentLines = false

        log.debug({
            title: 'Create fulfillment',
            details: `SO ${soId} selectedLineKeys: ${JSON.stringify(selectedQtyByItem)}`
        })
        selectedLineKeys.forEach(lineKey => {
            //const index = lineKeyToIndex[String(lineKey)]
            const requestedQty = Number(selectedQtyByItem[lineKey]) || 0
            const index = fulfillment.getLineCount({ sublistId: 'item' })
            if (requestedQty <= 0) return

            for (let i = 0; i < index; i++) {
                const defaultQty = Number(fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i
                }))

                log.debug('defaultQty',
                    { defaultQty, requestedQty, lineKey }
                )

                const fulfillQty = defaultQty > 0 ? Math.min(requestedQty, defaultQty) : requestedQty
                if (fulfillQty <= 0) return

                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: true
                })

                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i,
                    value: fulfillQty
                })

                hasFulfillmentLines = true
            }
        })

        const lineCount = fulfillment.getLineCount({ sublistId: 'item' }) || 0
        for (let i = 0; i < lineCount; i++) {
            const lineKey = String(fulfillment.getSublistValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                line: i
            }) || '')

            if (!selectedQtyByItem[lineKey]) {
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: false
                })
            }
        }

        if (!hasFulfillmentLines) {
            log.debug({
                title: 'No valid fulfillment quantities',
                details: `SO ${soId}`
            })
            return
        }

        /*              const fulfillmentId = fulfillment.save({
                         ignoreMandatoryFields: true
                     }) 
             
                     log.debug({
                         title: 'Packed fulfillment created',
                         details: `SO ${soId} IF ${fulfillmentId}`
                     }) 
                         */
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

        log.debug({
            title: 'MR finished',
            details: `Usage ${summary.usage}, Yields ${summary.yields}, Concurrency ${summary.concurrency}`
        })
    }

    return { getInputData, map, reduce, summarize }

})