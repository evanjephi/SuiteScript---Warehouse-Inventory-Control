/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Author: Even Yohans | eveniezeryohans@gmail.com
 * Date: 2026-03-10
 * Purpose: Viso
 */

define(['N/record', 'N/log'], (record, log) => {

    function beforeSubmit(context) {
        const nr = context.newRecord
        if (nr.getValue('subsidiary') !== '2') return
        const count = nr.getLineCount({ sublistId: 'item' })
        if (!count) return

        if ([context.UserEventType.CREATE
        ].includes(context.type)) {
            for (let i = 0; i < count; i++) {
                const itemreceive = nr.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i
                })
                log.debug('itemreceive', itemreceive)
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

                    try {
                        const invdetail = nr.getSublistSubrecord({
                            sublistId: 'item',
                            fieldId: 'inventorydetail',
                            line: i
                        })
                        //log.debug('invdetail', invdetail)
                        const line = invdetail.getLineCount({
                            sublistId: 'inventoryassignment'
                        })
                        log.debug('line-count', line)
                        for (let j = 0; j < line; j++) {
                            invdetail.setSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'binnumber',
                                value: 301,
                                line: j
                            });

                            invdetail.setSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'inventorystatus',
                                value: 4,
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

                        log.debug('Catching qyy' + nr.id, qty)
                    } catch (e) {
                        log.error('InventoryDetail Error', e.message)
                    }
                }
            }
        }
    }
    return { beforeSubmit }
})