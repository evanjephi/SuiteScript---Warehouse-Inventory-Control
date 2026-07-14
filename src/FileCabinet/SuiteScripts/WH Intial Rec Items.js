/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Author: Even Yohans | eveniezeryohans@gmail.com
 * Date: 2026-03-10
 * Purpose: Viso
 */

define(['N/record', 'N/log', 'N/search'], (record, log, search) => {

    function afterSubmit(context) {
        const nr = record.load({
            type: context.newRecord.type,
            id: context.newRecord.id,
            isDynamic: false
        })
        //const nr = context.newRecord
        if (nr.getValue('subsidiary') !== '2') return
        const count = nr.getLineCount({ sublistId: 'item' })
        if (!count) return
        if ([context.UserEventType.EDIT
        ].includes(context.type)) {
            const toProcess = [8, 9, 12]
            for (let i = 0; i < count; i++) {
                const item = nr.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                })
                const is = search.lookupFields({
                    type: search.Type.ITEM,
                    id: item,
                    columns: ['class']
                })
                const itemreceive = nr.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i
                })
                if (itemreceive === true || itemreceive === 'T') {
                    const item = nr.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    })
                    const qty = nr.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: i
                    })
                    if (!toProcess.includes(Number(is.class[0].value))) continue
                    try {
                        const invdetail = nr.getSublistSubrecord({
                            sublistId: 'item',
                            fieldId: 'inventorydetail',
                            line: i
                        })
                        const line = invdetail.getLineCount({
                            sublistId: 'inventoryassignment'
                        })
                        invdetail.setSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId: 'binnumber',
                            value: 301,
                            line: 0
                        })
                        invdetail.setSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId: 'quantity',
                            value: qty,
                            line: 0
                        })
                    } catch (e) {
                        log.error('InventoryDetail Error', e.message)
                    }
                }
            }
           nr.save()
        }
    }

    return { afterSubmit }
})