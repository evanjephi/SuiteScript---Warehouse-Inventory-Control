/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/runtime'], (record, runtime) => {

    const WHRBIN = 301
    const WHSBIN = 302
    const HOLD_STATUS = 4
    const GOOD_STATUS = 1
    const LOCATION = 1

    const getInputData = () => {
        const data = JSON.parse(runtime.getCurrentScript().getParameter('custscript_data'));
        return data
    }

    const map = (context) => {
        const value = JSON.parse(context.value);

        context.write({
            key: value.item,
            value: value
        })
    }

    const reduce = (context) => {

    };

    return { getInputData, map, reduce }

    function trackQCItemSO() {
        // In your POST handler when QC qty is submitted
        lines.forEach(({ soId, lineIndex, confirmQty }) => {

            const rec = record.load({
                type: record.Type.SALES_ORDER,
                id: soId
            })

            const orderedQty = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: line
            })

            const alreadyPrepared = Number(rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_qty_prepared',
                line: line
            })) || 0

            const newPreparedQty = alreadyPrepared + Number(confirmQty)

            // Determine stage
            let stage
            if (newPreparedQty <= 0) {
                stage = 'pending'
            } else if (newPreparedQty < orderedQty) {
                stage = 'partial'
            } else {
                stage = 'prepared'
            }

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_qty_prepared',
                line: lineIndex,
                value: newPreparedQty
            })

            rec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_prep_stage',
                line: lineIndex,
                value: stage
            })

            rec.save()
        })
    }

    function binTransfer() {

        const data = JSON.parse(context.values[0])

        const transfer = record.create({
            type: record.Type.BIN_TRANSFER,
            isDynamic: true
        })

        transfer.setValue({ fieldId: 'location', value: LOCATION })
        transfer.setValue({ fieldId: 'transferlocation', value: LOCATION })

        transfer.selectNewLine({ sublistId: 'inventory' })

        transfer.setCurrentSublistValue({
            sublistId: 'inventory',
            fieldId: 'item',
            value: data.item
        })

        transfer.setCurrentSublistValue({
            sublistId: 'inventory',
            fieldId: 'adjustqtyby',
            value: data.qty
        })

        const invDetail = transfer.getCurrentSublistSubrecord({
            sublistId: 'inventory',
            fieldId: 'inventorydetail'
        });

        invDetail.selectNewLine({ sublistId: 'inventoryassignment' });

        // FROM
        invDetail.setCurrentSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'binnumber',
            value: WHSBIN
        })

        invDetail.setCurrentSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'inventorystatus',
            value: GOOD_STATUS
        })

        // TO
        invDetail.setCurrentSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'tobinnumber',
            value: WHRBIN
        })

        invDetail.setCurrentSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'toinventorystatus',
            value: HOLD_STATUS
        })

        invDetail.setCurrentSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'quantity',
            value: data.qty
        })

        invDetail.commitLine({ sublistId: 'inventoryassignment' });

        transfer.commitLine({ sublistId: 'inventory' });

        transfer.save();
    }
})

