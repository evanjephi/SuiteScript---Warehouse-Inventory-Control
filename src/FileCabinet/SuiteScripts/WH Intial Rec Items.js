/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Author: Even Yohans | eveniezeryohans@gmail.com
 * Date: 2026-03-10
 * Purpose: Viso
 */

define(['N/record', 'N/log', 'N/search'], (record, log, search) => {

    function beforeSubmit(context) {
        const nr = context.newRecord
        if (nr.getValue('subsidiary') !== '2') return
        const count = nr.getLineCount({ sublistId: 'item' })
        if (!count) return
        if ([context.UserEventType.CREATE
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
                if (itemreceive === true) {
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
                    log.debug('item qty details', {isName: typeof is.class[0]?.value, is: typeof is, item, qty, qty: typeof qty, item: typeof item})
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
                        for (let j = 0; j < line; j++) {
                            invdetail.setSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'binnumber',
                                value: 301,
                                line: j
                            });
                            if (line === 1) {
                                invdetail.setSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'quantity',
                                    value: qty,
                                    line: j
                                });
                            }
                        }
                        log.debug('Qyy' + nr.id, qty)
                    } catch (e) {
                        log.error('InventoryDetail Error', e.message)
                    }
                }
            }
        }
    }

    return { beforeSubmit }
})