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
        let isEligible = false

        lines.forEach((line) => {
            const item = Number(line.item)
            const qty = Number(line.qty)
            if (!item || qty <= 0) return

            const bin = Number(line.bin || WHRBIN)
            const onhandHoldByItem = getOnhandHoldQtyByItem(item)
            const goodQty = Number(onhandHoldByItem[GOOD_STATUS] || 0)
            const holdQty = Number(onhandHoldByItem[HOLD_STATUS] || 0)

            if (goodQty >= qty) {
                log.debug('good qty sufficient', {
                    item, goodQty,
                    requiredQty: qty
                })
                return
            }

            if (holdQty < qty) return log.error({
                title: 'Not enough',
                details: `Item ${item} has ${holdQty} 
                on hand, but ${qty} is required`
            })

            const scLine = statusChange.getLineCount({ sublistId: 'inventory' })

            statusChange.insertLine({
                sublistId: 'inventory',
                line: scLine
            })

            statusChange.setSublistValue({
                sublistId: 'inventory',
                fieldId: 'item',
                line: scLine,
                value: item
            })

            statusChange.setSublistValue({
                sublistId: 'inventory',
                fieldId: 'quantity',
                line: scLine,
                value: qty
            })

            const invDetail = statusChange.getSublistSubrecord({
                sublistId: 'inventory',
                fieldId: 'inventorydetail',
                line: scLine
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

            isEligible = true
        })

        if (isEligible) {
            const statusChangeId = statusChange.save()
            log.debug({
                title: 'Inventory SC created',
                details: `ID ${statusChangeId}`
            })
        }
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

        const memo = 'Items made available for ' + tranId

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
            updateSoCommitInventory(salesOrder, items)
        } catch (e) {
            log.error({
                title: `Failed to update commit inventory for SO ${soId}`,
                details: e.message || String(e)
            })
            return
        }

        // Step 3: create item fulfillment for the SO
        createPackedFulfillment(soId, items)
    }

    function collectEligibleSoItems(salesOrder) {
        const items = []
        const lineCount = salesOrder.getLineCount({ sublistId: 'item' }) || 0
        const isReleased = salesOrder.getValue({ fieldId: 'custbody_release_order' })

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
        const lineItemToIndex = buildlineItemToIndexMap(salesOrder)
        let hasChanges = false

        items.forEach(({ lineUniqueKey }) => {
            const index = lineItemToIndex[String(lineUniqueKey)]
            if (index === undefined) return

            if (salesOrder.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: index
            }) === 'InvtPart') {
                if (Number(salesOrder.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'commitinventory',
                    line: index
                })) === 1) { return } else {
                    salesOrder.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'commitinventory',
                        line: index,
                        value: 1
                    })
                    hasChanges = true
                }
            }
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
                const comp = getKitComponents(inventoryItemId, qty)
                components = comp.components
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
            details: `return: ${JSON.stringify(Object.values(aggregated).filter(l => l.item && l.qty > 0))}`
        })
        return Object.values(aggregated).filter(l => l.item && l.qty > 0)
    }

    function getKitComponents(kitItemId, kitQty) {
        const components = []
        const kitKey = String(kitItemId)
        const memberData = {}
        memberData[kitKey] = []
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
                    const existing = memberData[kitKey].find(m => m.itemId === memberId)
                    if (existing) {
                        existing.qty += memberQty * kitQty
                    } else {
                        memberData[kitKey].push({ itemId: memberId, qty: memberQty * kitQty })
                    }
                }
                return true
            })
        } catch (e) {
            log.error({
                title: `Failed to resolve kit components for item ${kitItemId}`,
                details: e.message || String(e)
            })
        }
        return { components, memberData }
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

        try {
            const fulfillment = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: soId,
                toType: record.Type.ITEM_FULFILLMENT,
                isDynamic: false
            })

            fulfillment.setValue({ fieldId: 'shipstatus', value: 'B' })
            const today = new Date()
            const selectedPlan = selectedItems.reduce((acc, item) => {
                const qty = Number(item.qtyRemaining) || 0
                if (qty <= 0) return acc

                if (item.itemType === 'Kit') {
                    const kitKey = String(item.itemId)
                    if (!acc.kits[kitKey]) {
                        acc.kits[kitKey] = {
                            kitItemId: String(item.itemId),
                            kitQty: 0,
                            components: {}
                        }
                    }

                    acc.kits[kitKey].kitQty += qty

                    const comp = getKitComponents(item.itemId, qty)
                    const exComps = Object.values(comp.memberData)
                        .flat()
                        .filter(c => c && c.itemId && Number(c.qty) > 0)

                    exComps.forEach(c => {
                        const compId = String(c.itemId)
                        const compQty = Number(c.qty) || 0
                        if (compQty <= 0) return
                        acc.kits[kitKey].components[compId] =
                            (acc.kits[kitKey].components[compId] || 0) + compQty
                    })
                } else {
                    const itemKey = String(item.itemId)
                    acc.direct[itemKey] = (acc.direct[itemKey] || 0) + qty
                }

                return acc
            }, { direct: {}, kits: {} })

            const selectedLineItem = Object.entries(selectedPlan)
            let hasFulfillmentLines = false

            log.debug({
                title: 'Selected Plan',
                details: JSON.stringify(selectedPlan)
            })

            log.debug({
                title: 'Selected Line Items',
                details: JSON.stringify(selectedLineItem)
            })
            selectedLineItem.forEach(([lineItem, lineData]) => {
                let requestedItemId = null
                let requestedQty = 0
                log.debug({
                    title: 'Create fulfillment',
                    details: `lineItem: ${JSON.stringify(lineItem)}, lineData: ${JSON.stringify(lineData)}`
                })
                if (lineItem === 'kits') {
                    Object.entries(lineData).forEach(([linekey, linedata]) => {
                        // kitKey = 53771
                        // kitData.kitQty = 10
                        // kitData.components = { 927: 10, 930: 10 }
                        log.debug({
                            title: 'Kit fulfillment',
                            details: `components: ${JSON.stringify(linedata.components)}`
                        })
                        requestVsFulfillline(fulfillment, linedata.components)
                    })
                } else {
                    log.debug({
                        title: 'Direct fulfillment',
                        details: `components: ${JSON.stringify(lineData)}`
                    })
                    requestVsFulfillline(fulfillment, lineData)
                }


                //if (requestedQty <= 0) return
                // for (let i = 0; i < index; i++) {
                // const itemtype = fulfillment.getSublistValue({
                //     sublistId: 'item',
                //     fieldId: 'itemtype',
                //     line: i
                // })
                // const defaultQty = Number(fulfillment.getSublistValue({
                //     sublistId: 'item',
                //     fieldId: 'quantity',
                //     line: i
                // }))

                // const ifItem = String(fulfillment.getSublistValue({
                //     sublistId: 'item',
                //     fieldId: 'item',
                //     line: i
                // }))

                //const components = itemtype === 'Kit' ? kits[ifItem]?.components : direct[ifItem]
                // log.debug({
                //     title: 'components check',
                //     details: `line ${i} item ${ifItem} type ${itemtype} components ${JSON.stringify(components)}`
                // })

                // const fulfillQty = defaultQty > 0 ? Math.min(requestedQty, defaultQty) : requestedQty

                // if (fulfillQty <= 0) return
                // fulfillment.setSublistValue({
                //     sublistId: 'item',
                //     fieldId: 'itemreceive',
                //     line: i,
                //     value: true
                // })

                // fulfillment.setSublistValue({
                //     sublistId: 'item',
                //     fieldId: 'quantity',
                //     line: i,
                //     value: fulfillQty
                // })

                // hasFulfillmentLines = true

                // const invdetail = fulfillment.getSublistSubrecord({
                //     sublistId: 'item',
                //     fieldId: 'inventorydetail',
                //     line: i
                // })
                // if (!invdetail) {
                //     log.error({
                //         title: 'Missing inventory detail subrecord',
                //         details: `SO ${soId} line ${i} item ${ifItem} type ${itemtype}`
                //     })
                //     continue
                // }

                // let assignmentCount = invdetail.getLineCount({
                //     sublistId: 'inventoryassignment'
                // })

                // if (assignmentCount === 0) {
                //     invdetail.insertLine({
                //         sublistId: 'inventoryassignment',
                //         line: 0
                //     })
                //     assignmentCount = 1
                // }

                // for (let j = 0; j < assignmentCount; j++) {
                //     invdetail.setSublistValue({
                //         sublistId: 'inventoryassignment',
                //         fieldId: 'binnumber',
                //         value: 301,
                //         line: j
                //     })

                //     invdetail.setSublistValue({
                //         sublistId: 'inventoryassignment',
                //         fieldId: 'inventorystatus',
                //         value: 4,
                //         line: j
                //     })

                //     invdetail.setSublistValue({
                //         sublistId: 'inventoryassignment',
                //         fieldId: 'quantity',
                //         value: j === 0 ? fulfillQty : 0,
                //         line: j
                //     })

                // }
                // }
            })

            if (!hasFulfillmentLines) {
                log.debug({
                    title: 'No valid fulfillment quantities',
                    details: `SO ${soId}`
                })
                return
            }

            // const fulfillmentId = fulfillment.save({
            //     ignoreMandatoryFields: true
            // })

            // log.debug({
            //     title: 'Packed fulfillment created',
            //     details: `SO ${soId} IF ${fulfillmentId}`
            // })
        } catch (e) {
            log.error({
                title: `IF Failer SO ${soId}`,
                details: e.message || String(e)
            })
        }
    }

    function buildlineItemToIndexMap(rec) {
        const map = {}
        const lineCount = rec.getLineCount({ sublistId: 'item' }) || 0

        for (let i = 0; i < lineCount; i++) {
            if (rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            }) === 'InvtPart') {
                const key = rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    line: i
                })
                if (key !== null && key !== undefined && key !== '') {
                    map[String(key)] = i
                }
            }
        }

        return map
    }

    // function requestVsFulfillline(rec, reqdata) {
    //     const index = rec.getLineCount({ sublistId: 'item' })
    //     for (let i = 0; i < index; i++) {
    //         const itemtype = rec.getSublistValue({
    //             sublistId: 'item',
    //             fieldId: 'itemtype',
    //             line: i
    //         })
    //         const defaultQty = Number(rec.getSublistValue({
    //             sublistId: 'item',
    //             fieldId: 'quantity',
    //             line: i
    //         }))
    //         const ifItem = String(rec.getSublistValue({
    //             sublistId: 'item',
    //             fieldId: 'item',
    //             line: i
    //         }))

    //         log.debug('Requested vs Fulfill line', {
    //             reqdata, ifItem
    //         })
    //     }
    // }

    function requestVsFulfillline(rec, reqdata) {
        const requestedItems = Object.entries(reqdata).map(([itemId, qty]) => ({
            itemId: String(itemId),
            qty: Number(qty)
        }))

        requestedItems.forEach(({ itemId, qty }) => {
            const index = rec.getLineCount({ sublistId: 'item' })

            for (let i = 0; i < index; i++) {
                const ifItem = String(rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                }))

                if (ifItem !== itemId) continue

                log.debug('Requested vs Fulfill line', {
                    itemId,
                    qty,
                    ifItem,
                    line: i
                })
                break
            }
        })
    }

    function getOnhandHoldQtyByItem(requestedItem) {
        let itemStatusQty = {}

        search.create({
            type: 'inventorybalance',
            filters: [
                ['item', 'anyof', requestedItem],
                'AND',
                ['location', 'anyof', LOCATION],
                'AND',
                ['binnumber', 'anyof', WHRBIN],
                'AND',
                ['status', 'anyof', [HOLD_STATUS, GOOD_STATUS]]
            ],
            columns: [
                search.createColumn({ name: 'item' }),
                search.createColumn({ name: 'binnumber' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'available' }),
                search.createColumn({ name: 'onhand' })
            ]
        }).run().each(r => {
            const status = Number(r.getValue({ name: 'status' }))
            const onHand = Number(r.getValue({ name: 'onhand' }))
            itemStatusQty[status] = onHand

            return true
        })

        return itemStatusQty
    }

    function summarize(summary) {
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error({
                title: `Map error ${key}`, details: error
            })
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