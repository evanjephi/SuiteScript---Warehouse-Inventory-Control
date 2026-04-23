/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/task'], (ui, search, task) => {
    const onRequest = (context) => {

        if (context.request.method === 'GET') {
            const WHRBIN = 301
            const WHSBIN = 302
            const LOCATION = 1
            const CLASS = 13
            const STATUS = {
                Hold: 4,
                Good: 1,
                QC: 3
            }
            const form = ui.createForm({ title: 'Inventory Management Control' });
            form.addField({ id: 'filterbyname', type: ui.FieldType.SELECT, label: 'Seach Item', source: 'item' })
            //form.addButton({ id: 'search_item', label: 'Search', functionName: 'searchItem' })
            form.addSubmitButton({ label: 'Search' })
            // form.addButton({ id: 'rcv_submit_btn', label: 'Receiving Action', functionName: 'handleRcvItems' })
            // form.addButton({ id: 'qc_submit_btn', label: 'QC Action', functionName: 'handleQcItems' })

            //add a hidden field
            const actionField = form.addField({
                id: 'custpage_action',
                type: ui.FieldType.TEXT,
                label: 'Action'
            })
            actionField.updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN })

            form.clientScriptModulePath = '/SuiteScripts/ WHIM Inventory MG Control CS EY.js'

            // Sales Order fulfilment
            releasedOrders(form, LOCATION, CLASS)
            // Sales Order QC Release
            soProductionQCStage(form, LOCATION, CLASS)
            //Warehouse Receiving
            const receiveitems_sb = form.addSublist({
                id: 'warehousereceiving',
                type: ui.SublistType.LIST,
                label: 'Warehouse Receiving'
            })
            receiveitems_sb.addMarkAllButtons()
            receiveitems_sb.addField({ id: 'rcv_select', type: ui.FieldType.CHECKBOX, label: 'Select' })
            receiveitems_sb.addField({ id: 'rcv_itemid', type: ui.FieldType.TEXT, label: 'Internal ID' })
            receiveitems_sb.addField({ id: 'rcv_item', type: ui.FieldType.TEXT, label: 'Item' })
            receiveitems_sb.addField({ id: 'rcv_itembin', type: ui.FieldType.TEXT, label: 'Current Storage' })
            receiveitems_sb.addField({ id: 'rcv_qty', type: ui.FieldType.INTEGER, label: 'Quantity' })
            receiveitems_sb.addField({ id: 'rcv_itemstatus', type: ui.FieldType.TEXT, label: 'Status' })
            receiveitems_sb.addField({ id: 'rcv_confirmqty', type: ui.FieldType.INTEGER, label: 'Confirm Quantity' })
                .updateDisplayType({ displayType: ui.FieldDisplayType.ENTRY })
            const statusField = receiveitems_sb.addField({
                id: 'rcv_updatestatus',
                type: ui.FieldType.SELECT,
                label: 'Update Status'
            })
            addStatusOptions(statusField, STATUS, [1])

            //Production QC
            const productqc_sb = form.addSublist({
                id: 'productqc',
                type: ui.SublistType.LIST,
                label: 'In Production - QC Stage'
            })
            productqc_sb.addMarkAllButtons()
            productqc_sb.addField({ id: 'qc_select', type: ui.FieldType.CHECKBOX, label: 'Select' })
            productqc_sb.addField({ id: 'qc_itemid', type: ui.FieldType.TEXT, label: 'Internal ID' })
            productqc_sb.addField({ id: 'qc_item', type: ui.FieldType.TEXT, label: 'Item' })
            productqc_sb.addField({ id: 'qc_itembin', type: ui.FieldType.TEXT, label: 'Current Storage' })
            productqc_sb.addField({ id: 'qc_qty', type: ui.FieldType.INTEGER, label: 'Quantity' })
            productqc_sb.addField({ id: 'qc_itemstatus', type: ui.FieldType.TEXT, label: 'Status' })
            productqc_sb.addField({ id: 'qc_confirmqty', type: ui.FieldType.INTEGER, label: 'Confirm Quantity' })
                .updateDisplayType({ displayType: ui.FieldDisplayType.ENTRY })
            const prodStatusField = productqc_sb.addField({
                id: 'qc_updatestatus',
                type: ui.FieldType.SELECT,
                label: 'Update Status'
            })
            addStatusOptions(prodStatusField, STATUS, [4])

            //Items In Storage
            const storeditems_sb = form.addSublist({
                id: 'warehousestorage',
                type: ui.SublistType.LIST,
                label: 'Items In Storage'
            })
            storeditems_sb.addField({ id: 'itemid', type: ui.FieldType.TEXT, label: 'Internal ID' })
            storeditems_sb.addField({ id: 'item', type: ui.FieldType.TEXT, label: 'Item' })
            storeditems_sb.addField({ id: 'itembin', type: ui.FieldType.TEXT, label: 'Current Storage' })
            storeditems_sb.addField({ id: 'qty', type: ui.FieldType.INTEGER, label: 'Quantity' })
            storeditems_sb.addField({ id: 'itemstatus', type: ui.FieldType.TEXT, label: 'Status' })

            // Load Saved Search
            const ss = search.create({
                type: 'inventorybalance',
                filters: [
                    ['location', 'anyof', LOCATION],
                    'AND',
                    ['binnumber', 'anyof', [WHRBIN, WHSBIN]],
                ],
                columns: ['item', 'location', 'binnumber', 'onhand', 'status']
            })

            let storageLine = 0
            let receivingLine = 0
            let productQCLine = 0

            ss.run().each(result => {
                const resbin = Number(result.getValue('binnumber'))
                const itemstatus = Number(result.getValue('status'))
                if (resbin === WHSBIN) {
                    storeditems_sb.setSublistValue({
                        id: 'item',
                        line: storageLine,
                        value: result.getText('item')
                    });

                    storeditems_sb.setSublistValue({
                        id: 'itemid',
                        line: storageLine,
                        value: result.getValue('item')
                    });

                    storeditems_sb.setSublistValue({
                        id: 'itembin',
                        line: storageLine,
                        value: result.getText('binnumber')
                    })

                    storeditems_sb.setSublistValue({
                        id: 'qty',
                        line: storageLine,
                        value: result.getValue('onhand')
                    });

                    storeditems_sb.setSublistValue({
                        id: 'itemstatus',
                        line: storageLine,
                        value: result.getText('status')
                    })
                    // log.debug('Storage Items ', {
                    //     item: result.getText('item'),
                    //     bin: result.getText('binnumber'),
                    //     status: result.getValue('status')
                    // })
                    storageLine++
                } else if (resbin === WHRBIN && itemstatus === STATUS.Hold) {
                    receiveitems_sb.setSublistValue({
                        id: 'rcv_item',
                        line: receivingLine,
                        value: result.getText('item')
                    });

                    receiveitems_sb.setSublistValue({
                        id: 'rcv_itemid',
                        line: receivingLine,
                        value: result.getValue('item')
                    });

                    receiveitems_sb.setSublistValue({
                        id: 'rcv_itembin',
                        line: receivingLine,
                        value: result.getText('binnumber')
                    })

                    receiveitems_sb.setSublistValue({
                        id: 'rcv_qty',
                        line: receivingLine,
                        value: result.getValue('onhand')
                    });

                    receiveitems_sb.setSublistValue({
                        id: 'rcv_itemstatus',
                        line: receivingLine,
                        value: result.getText('status')
                    })

                    receiveitems_sb.setSublistValue({
                        id: 'rcv_updatestatus',
                        line: receivingLine,
                        value: STATUS['QC']
                    })
                    // log.debug('In warehouse receiving ', {
                    //     item: result.getText('item'),
                    //     bin: result.getText('binnumber'),
                    //     status: result.getValue('status')
                    // })
                    receivingLine++
                } else if (resbin === WHRBIN && itemstatus === STATUS.QC) {
                    productqc_sb.setSublistValue({
                        id: 'qc_item',
                        line: productQCLine,
                        value: result.getText('item')
                    });

                    productqc_sb.setSublistValue({
                        id: 'qc_itemid',
                        line: productQCLine,
                        value: result.getValue('item')
                    });

                    productqc_sb.setSublistValue({
                        id: 'qc_itembin',
                        line: productQCLine,
                        value: result.getText('binnumber')
                    })

                    productqc_sb.setSublistValue({
                        id: 'qc_qty',
                        line: productQCLine,
                        value: result.getValue('onhand')
                    });

                    productqc_sb.setSublistValue({
                        id: 'qc_itemstatus',
                        line: productQCLine,
                        value: result.getText('status')
                    })

                    // productqc_sb.setSublistValue({
                    //     id: 'qc_confirmqty',
                    //     line: productQCLine,
                    //     value: 
                    // })

                    productqc_sb.setSublistValue({
                        id: 'qc_updatestatus',
                        line: productQCLine,
                        value: STATUS['QC']
                    })
                    // log.debug('In warehouse receiving ', {
                    //     item: result.getText('item'),
                    //     bin: result.getText('binnumber'),
                    //     status: result.getValue('status')
                    // })
                    productQCLine++
                }

                return true
            })
            //form.addSubmitButton({ label: 'Move to Storage' })
            context.response.writePage(form);

        } else {

            const request = context.request
            const body = JSON.parse(context.request.body)
            const action = body.action
            const lines = body.lines
            let data = [];

            log.debug('action', action)
            log.debug('lines', JSON.stringify(lines))

            if (action === 'receiving') {
                lines.forEach(function (line) {
                    log.debug('Line ' + line.line, 'Confirm Qty: ' + line.confirmQty)
                    // your logic here

                })
                context.response.setHeader({ name: 'Content-Type', value: 'application/json' })
                context.response.write(JSON.stringify({ message: 'Submitted for QC' }))
            }

            if (action === 'qc') {
                lines.forEach(function (line) {
                    log.debug({
                        confirmQty: line.confirmQty,

                    })
                    const lineCount = request.getLineCount({ group: 'warehousestorage' });
                    //get suitlet items, and transfer warehouse storage items to receiving items
                    let data = [];

                    for (let i = 0; i < lineCount; i++) {

                        const selected = request.getSublistValue({
                            group: 'warehousestorage',
                            name: 'select',
                            line: i
                        });

                        if (selected === 'T') {
                            data.push({
                                item: request.getSublistValue({
                                    group: 'warehousestorage',
                                    name: 'itemid',
                                    line: i
                                }),
                                qty: request.getSublistValue({
                                    group: 'warehousestorage',
                                    name: 'qty',
                                    line: i
                                })
                            });
                        }
                    }
                    //your logic here
                    const mrTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                        scriptId: 'customscript_ey_whim_inventory_control_mr',
                        deploymentId: 'customdeploy_ey_whim_control_mr',
                        params: {

                            custscript_data: JSON.stringify(line)
                        }
                    })

                    mrTask.submit()
                    context.response.setHeader({ name: 'Content-Type', value: 'application/json' })
                    context.response.write(JSON.stringify({ message: 'QC completed, Item is being packaged' }))
                })
            }

            if (action === 'releasing') {
                lines.forEach(line => {
                    log.debug('Releasing Line ' + line.line, 'Confirm Qty: ' + line.confirmQty)

                    context.response.setHeader({ name: 'Content-Type', value: 'application/json' })

                    context.response.write(JSON.stringify({
                        message: 'Packaging Completed. Item avaliable for Sales Order Fulfilment.'
                    }))

                })
            }

            if (action === 'soQCRelease') {

                log.debug('soQCRelease lines', JSON.stringify(lines))

                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_ey_whim_inventory_control_mr',
                    deploymentId: 'customdeploy_ey_whim_control_mr',
                    params: {
                        custscript_mr_action: action,
                        custscript_data: JSON.stringify(lines)
                    }
                })

                mrTask.submit()

                context.response.setHeader({ name: 'Content-Type', value: 'application/json' })
                context.response.write(JSON.stringify({
                    message: 'Sales order is now in QC production stage. Items are available for assembly.'
                }))
            }


        }
    }

    return { onRequest }


    function releasedOrders(form, loc, ot) {

        const salesorder_sb = form.addSublist({
            id: 'sb_salesorder',
            type: ui.SublistType.LIST,
            label: 'Release for Shipment'
        })
        salesorder_sb.addField({ id: 'so_id', type: ui.FieldType.TEXT, label: 'SO ID' })

        salesorder_sb.addField({ id: 'so_select', type: ui.FieldType.CHECKBOX, label: 'Select' })
        salesorder_sb.addField({ id: 'so_tranid', type: ui.FieldType.TEXT, label: 'SO #' })
        salesorder_sb.addField({ id: 'so_status', type: ui.FieldType.TEXT, label: 'Status' })
        salesorder_sb.addField({ id: 'so_item', type: ui.FieldType.TEXT, label: 'Item' })
        salesorder_sb.addField({ id: 'so_itemqty', type: ui.FieldType.INTEGER, label: 'Order Qty' })
        salesorder_sb.addField({ id: 'so_itemfulqty', type: ui.FieldType.INTEGER, label: 'Qty To Be Shipped' })
        salesorder_sb.addField({ id: 'so_confirmqty', type: ui.FieldType.INTEGER, label: 'Confirm Shippable Qty' })
            .updateDisplayType({ displayType: ui.FieldDisplayType.ENTRY })


        const so_ss = search.create({
            type: 'salesorder',
            filters: [
                ['mainline', 'is', 'F'],
                'AND',
                ['location', 'anyof', loc],
                'AND',
                ['ordertype', 'anyof', ot],
                'AND',
                ['item.type', 'anyof', ['InvtPart', 'Kit']],
                'AND',
                ['taxline', 'is', 'F'],
                'AND',
                ['status', 'anyof', [
                    'SalesOrd:D',
                    'SalesOrd:E',
                    'SalesOrd:B',
                    'SalesOrd:F'
                ]]
            ],
            columns: [
                'tranid',
                'status',
                'item',
                'quantity',
                'quantityuom',
                'quantitycommitted',
                'quantityshiprecv',
                'custbody_release_order',
                'custcol_release_order'
            ]
        })


        const soContent = {}
        so_ss.run().each(s => {
            const tranid = s.getValue('tranid')
            const status = s.getText('status')
            const item = s.getText('item')

            const qty = Number(s.getValue('quantity')) || 0
            const qtyfulf = Number(s.getValue('quantityshiprecv')) || 0
            const qtycomm = Number(s.getValue('quantitycommitted')) || 0
            const isMainRelease = s.getValue('custbody_release_order')
            const isLineRelease = s.getValue('custcol_release_order')
            if (!isMainRelease) return true
            if (item && qtyfulf >= 0 && qtyfulf < qty) {
                if (!isLineRelease) return true
                if (!soContent[tranid]) {
                    soContent[tranid] = {
                        status: status,
                        items: []
                    }
                }

                soContent[tranid].items.push({
                    item,
                    qty,
                    qtyfulf,
                    qtycomm
                })
            }

            return true
        })

        log.debug('soContent', soContent)
        let soLine = 0
        for (const tranid in soContent) {
            const so = soContent[tranid]

            so.items.forEach((i, index) => {
                salesorder_sb.setSublistValue({ id: 'so_tranid', line: soLine, value: index === 0 ? tranid : ' ' })
                salesorder_sb.setSublistValue({ id: 'so_status', line: soLine, value: index === 0 ? so.status : ' ' })

                salesorder_sb.setSublistValue({ id: 'so_item', line: soLine, value: i.item || ' ' })
                salesorder_sb.setSublistValue({ id: 'so_itemqty', line: soLine, value: i.qty })
                salesorder_sb.setSublistValue({ id: 'so_itemfulqty', line: soLine, value: i.qty - i.qtyfulf })
                salesorder_sb.setSublistValue({ id: 'so_id', line: soLine, value: tranid })
                soLine++;
            })
        }
    }

    function soProductionQCStage(form, loc, ot) {
        const so_productqc_sb = form.addSublist({
            id: 'soproductqc',
            type: ui.SublistType.LIST,
            label: 'Order Preparation'
        })
        so_productqc_sb.addField({ id: 'so_qctranidref', type: ui.FieldType.TEXT, label: 'Ref.' })
        so_productqc_sb.addField({ id: 'so_qcid', type: ui.FieldType.INTEGER, label: 'SO ID' })
            .updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN })
        so_productqc_sb.addField({ id: 'so_qclineindex', type: ui.FieldType.INTEGER, label: 'Line Index' })
            .updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN })
        so_productqc_sb.addField({ id: 'so_qcselect', type: ui.FieldType.CHECKBOX, label: 'Select' })
        so_productqc_sb.addField({ id: 'so_qctranid', type: ui.FieldType.TEXT, label: 'SO #' })
        so_productqc_sb.addField({ id: 'so_qcstatus', type: ui.FieldType.TEXT, label: 'Status' })
        so_productqc_sb.addField({ id: 'so_qcitem', type: ui.FieldType.TEXT, label: 'Item' })
        so_productqc_sb.addField({ id: 'so_qcitemqty', type: ui.FieldType.INTEGER, label: 'Order Qty Needed' })
        so_productqc_sb.addField({ id: 'so_qcconfirmqty', type: ui.FieldType.INTEGER, label: 'Confirm QC Qty' })
            .updateDisplayType({ displayType: ui.FieldDisplayType.ENTRY })

        const so_qc_ss = search.create({
            type: 'salesorder',
            filters: [
                ['mainline', 'is', 'F'],
                'AND',
                ['location', 'anyof', loc],
                'AND',
                ['ordertype', 'anyof', ot],
                'AND',
                ['item.type', 'anyof', ['InvtPart', 'Kit']],
                'AND',
                ['taxline', 'is', 'F'],
                'AND',
                ['status', 'anyof', [
                    'SalesOrd:D',
                    'SalesOrd:E',
                    'SalesOrd:B',
                    'SalesOrd:F'
                ]]
            ],
            columns: [
                'internalid',
                'tranid',
                'status',
                'item',
                'type',
                'quantity',
                'quantityuom',
                'quantitycommitted',
                'quantityshiprecv',
                'custbody_release_order',
                'custcol_release_order',
                { name: 'line' }
            ]
        })


        const soContent = {}
        so_qc_ss.run().each(s => {
            const soid = Number(s.getValue('internalid'))
            const tranid = s.getValue('tranid')
            const status = s.getText('status')
            const item = s.getText('item')

            const qty = Number(s.getValue('quantity')) || 0
            const qtyfulf = Number(s.getValue('quantityshiprecv')) || 0
            const qtycomm = Number(s.getValue('quantitycommitted')) || 0
            const isMainRelease = s.getValue('custbody_release_order')
            const isLineRelease = s.getValue('custcol_release_order')

            if (!isMainRelease) return true
            if (item && qtyfulf >= 0 && qtyfulf < qty) {
                if (!isLineRelease) return true

                if (!soContent[tranid]) {
                    soContent[tranid] = {
                        id: soid,
                        status: status,
                        items: []
                    }
                }

                soContent[tranid].items.push({
                    item,
                    qty,
                    qtyfulf,
                    qtycomm,
                    lineIndex: s.getValue('line')
                })
            }

            return true
        })

        log.debug('soContent', soContent)
        let soLine = 0
        for (const tranid in soContent) {
            const so = soContent[tranid]

            so.items.forEach((i, index) => {
                so_productqc_sb.setSublistValue({ id: 'so_qctranid', line: soLine, value: index === 0 ? tranid : ' ' })
                so_productqc_sb.setSublistValue({ id: 'so_qclineindex', line: soLine, value: i.lineIndex })
                so_productqc_sb.setSublistValue({ id: 'so_qcstatus', line: soLine, value: index === 0 ? so.status : ' ' })

                so_productqc_sb.setSublistValue({ id: 'so_qcitem', line: soLine, value: i.item || ' ' })
                so_productqc_sb.setSublistValue({ id: 'so_qcitemqty', line: soLine, value: i.qty - i.qtyfulf })
                so_productqc_sb.setSublistValue({ id: 'so_qctranidref', line: soLine, value: tranid })
                so_productqc_sb.setSublistValue({ id: 'so_qcid', line: soLine, value: so.id })
                soLine++;
            })
        }
    }
})


function addStatusOptions(statusField, statusObj, excludeValues = []) {
    for (const name in statusObj) {
        if (excludeValues.includes(statusObj[name])) continue
        statusField.addSelectOption({
            value: statusObj[name],
            text: name
        })
    }
}