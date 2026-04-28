/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord'], function (currentRecord) {

    function pageInit(context) {
        setTimeout(function () {
            createButton('rcv_submit_btn', 'Submit for QC', handleRcvItems, 'warehousereceiving')
            createButton('qc_submit_btn', 'QC Completed', handleQcItems, 'productqc')
            createButton('so_submit_btn', 'Release For Shipment', handleReleaseSO, 'sb_salesorder')
            createButton('so_qc_submit_btn', 'Prepare For QC', handleQCRealeaseSO, 'soproductqc')

        }, 1000)
    }

    function createButton(id, label, fn, sublistId) {
        const btn = document.createElement('input')
        btn.type = 'button'
        btn.id = id
        btn.value = label
        btn.style.cssText = `
        background-color: #1a6fc4;
        border: none;
        color: white;
        font-size: 13px;
        padding: 5px 14px;
        border-radius: 3px;
        font-weight: bold;
        margin: 5px;
        cursor: pointer;
    `
        const textInput = document.createElement('input')
        textInput.type = 'text'
        textInput.id = id
        textInput.placeholder = 'Search Item'
        textInput.style.cssText = `
        border: none;
        font-size: 13px;
        padding: 5px 14px;
        border-radius: 3px;
        margin: 5px;
    `
        textInput.oninput = function () {
            const layer = []
            const searchVal = this.value.toLowerCase()
            const table = document.getElementById(sublistId + '_layer')

            if (!table) return
            if (fn === handleReleaseSO || fn === handleQCRealeaseSO) {
                table.querySelectorAll('tr[id^="' + sublistId + 'row"]').forEach(function (row) {
                    const soId = row.querySelector('[id^="so_id"]')
                    const soIdVal = soId ? soId.value.toLowerCase() : ''
                    const text = row.textContent.toLowerCase()
                    row.style.display = (text.includes(searchVal) || soIdVal.includes(searchVal)) ? '' : 'none'
                })
            } else table.querySelectorAll('tr[id^="' + sublistId + 'row"]').forEach(function (row) {
                const text = row.textContent.toLowerCase()
                row.style.display = text.includes(searchVal) ? '' : 'none'
            })
        }

        textInput.oninput = function () {
            const searchVal = this.value.toLowerCase()
            const layer = document.getElementById(sublistId + '_layer')
            if (!layer) return

            layer.querySelectorAll('tr[id^="' + sublistId + 'row"]').forEach(function (row) {
                const soId = row.querySelector('[id^="so_id"]')
                const soIdVal = soId ? soId.value.toLowerCase() : ''
                const text = row.textContent.toLowerCase()
                row.style.display = (text.includes(searchVal) || soIdVal.includes(searchVal)) ? '' : 'none'
            })
        }


        btn.addEventListener('mouseover', () => {
            btn.style.backgroundColor = '#155a9e'
        })

        btn.addEventListener('mouseout', () => {
            btn.style.backgroundColor = '#1a6fc4'
        })

        btn.onclick = fn

        const sublist = document.getElementById(sublistId + '_layer')
        if (sublist) {
            sublist.insertBefore(textInput, sublist.firstChild)
            sublist.appendChild(btn)
        } else {
            alert('sublist not found: ' + sublistId + '_layer')
        }
    }

    function handleReleaseSO() {
        const currRec = currentRecord.get()    // get once at the top

        if (!hasSelectedLine(currRec, 'sb_salesorder', ['so_select', 'so_confirmqty'])) {
            alert('Please check and confirm qty for at least one Sales Order for submission.')
            return
        }

        const lines = []
        const lineCount = currRec.getLineCount({ sublistId: 'sb_salesorder' })

        for (let i = 0; i < lineCount; i++) {
            const isSelected = currRec.getSublistValue({
                sublistId: 'sb_salesorder',
                fieldId: 'so_select',
                line: i
            })

            if (isSelected === true) {
                const qtyOrder = currRec.getSublistValue({
                    sublistId: 'sb_salesorder',
                    fieldId: 'so_qcitemqty',
                    line: i
                })
                const qtyNeeded = currRec.getSublistValue({
                    sublistId: 'sb_salesorder',
                    fieldId: 'so_itemqtyneeded',
                    line: i
                })
                const confirmQty = currRec.getSublistValue({
                    sublistId: 'sb_salesorder',
                    fieldId: 'so_confirmqty',
                    line: i
                })
                lines.push({ line: i, confirmQty })
            }
        }

        fetch(window.location.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'releasing', lines })
        })
            .then(res => res.json())
            .then(data => {
                alert(data.message)

                //const currRec = currentRecord.get()
                clearSelectedLine(currRec, lines, 'sb_salesorder', ['so_select', 'so_confirmqty'])
            })
            .catch(err => {
                alert('Error: ' + err)
            })
    }

    function handleQCRealeaseSO() {
        const currRec = currentRecord.get()

        if (!hasSelectedLine(currRec, 'soproductqc', ['so_qcselect', 'so_qcconfirmqty'])) {
            alert('Please check and confirm qty for at least one Sales Order for submission.')
            return
        }

        const lines = []
        const lineCount = currRec.getLineCount({ sublistId: 'soproductqc' })

        for (let i = 0; i < lineCount; i++) {
            const isSelected = currRec.getSublistValue({
                sublistId: 'soproductqc',
                fieldId: 'so_qcselect',
                line: i
            })

            if (isSelected === true) {
                const soId = currRec.getSublistValue({
                    sublistId: 'soproductqc',
                    fieldId: 'so_qcid',
                    line: i
                })
                const lineIndex = currRec.getSublistValue({
                    sublistId: 'soproductqc',
                    fieldId: 'so_qclineindex',
                    line: i
                })
                const qtyOrder = currRec.getSublistValue({
                    sublistId: 'soproductqc',
                    fieldId: 'so_qcitemqty',
                    line: i
                })
                const qtyNeeded = currRec.getSublistValue({
                    sublistId: 'soproductqc',
                    fieldId: 'so_qcitemqtyneeded',
                    line: i
                })
                const confirmQty = currRec.getSublistValue({
                    sublistId: 'soproductqc',
                    fieldId: 'so_qcconfirmqty',
                    line: i
                })

                //const autoQty = qtyOrder - qtyNeeded
                //console.log('Auto-calculated Confirm Qty: ' + autoQty + ' (Ordered Qty: ' + qtyOrder + ' - Qty Needed: ' + qtyNeeded + ')')
                //alert('Auto-calculated Confirm Qty: ' + autoQty + ' (Ordered Qty: ' + qtyOrder + ' - Qty Needed: ' + qtyNeeded + ')')
                //currRec.setCurrentSublistValue({ sublistId: 'soproductqc', fieldId: 'so_qcconfirmqty', value: autoQty > 0 ? autoQty : 0 })

                if (confirmQty > qtyOrder) {
                    alert('Confirm Qty cannot be greater than Ordered Qty (Line ' + (i + 1) + ')')
                    return
                }
                lines.push({ soId, lineIndex, line: i, qtyOrder, confirmQty })
            }
        }

        fetch(window.location.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'soQCRelease', lines })
        })
            .then(res => res.json())
            .then(data => {
                alert(data.message)

                //const currRec = currentRecord.get()
                clearSelectedLine(currRec, lines, 'soproductqc', ['so_qcselect', 'so_qcconfirmqty'])
            })
            .catch(err => {
                alert('Error: ' + err)
            })
    }

    function handleRcvItems() {
        const currRec = currentRecord.get()

        if (!hasSelectedLine(currRec, 'warehousereceiving', ['rcv_select', 'rcv_confirmqty'])) {
            alert('Please check at least one item for submission.')
            return
        }
        const lines = []
        const lineCount = currRec.getLineCount({ sublistId: 'warehousereceiving' })

        for (let i = 0; i < lineCount; i++) {
            const isSelected = currRec.getSublistValue({
                sublistId: 'warehousereceiving',
                fieldId: 'rcv_select',
                line: i
            })

            if (isSelected === true) {
                const confirmQty = currRec.getSublistValue({
                    sublistId: 'warehousereceiving',
                    fieldId: 'rcv_confirmqty',
                    line: i
                })
                lines.push({ line: i, confirmQty })
            }
        }

        fetch(window.location.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'receiving', lines })
        })
            .then(res => res.json())
            .then(data => {
                alert(data.message)
                clearSelectedLine(currRec, lines, 'warehousereceiving', ['rcv_select', 'rcv_confirmqty'])

            })
            .catch(err => {
                alert('Error: ' + err)
            })
    }

    function handleQcItems() {
        const currRec = currentRecord.get()

        if (!hasSelectedLine(currRec, 'productqc', ['qc_select', 'rcv_confirmqty'])) {
            alert('Please check at least one item for submission.')
            return
        }

        const lines = []
        const lineCount = currRec.getLineCount({ sublistId: 'productqc' })

        for (let i = 0; i < lineCount; i++) {
            const isSelected = currRec.getSublistValue({
                sublistId: 'productqc',
                fieldId: 'qc_select',
                line: i
            })

            if (isSelected === true) {
                const confirmQty = currRec.getSublistValue({
                    sublistId: 'productqc',
                    fieldId: 'qc_confirmqty',
                    line: i
                })
                const updatedStatus = currRec.getSublistValue({
                    sublistId: 'productqc',
                    fieldId: 'qc_updatestatus',
                    line: i
                })

                lines.push({ line: i, confirmQty, updatedStatus })
            }
        }

        fetch(window.location.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'qc', lines })
        })
            .then(res => res.json())
            .then(data => {
                alert(data.message)
                clearSelectedLine(currRec, lines, 'productqc', ['qc_select', 'qc_confirmqty'])

            })
            .catch(err => {
                alert('Error: ' + err)
            })
    }

    function fieldChanged(context) {
        const sublistId = context.sublistId
        const fieldId = context.fieldId
        const line = context.line
        console.log('Field Changed - Sublist: ' + sublistId + ', Field: ' + fieldId + ', Line: ' + line)
        const currRec = context.currentRecord

        if (sublistId === 'sb_salesorder' && fieldId === 'so_select') {
            // for (let i = 0; i < linecount; i++) {
                // if (i !== line) {
                //     currRec.setSublistValue({ sublistId, fieldId: 'so_select', line: i, value: false })
                //     currRec.setSublistValue({ sublistId, fieldId: 'so_confirmqty', line: i, value: '' })
                // }

                const isSelected = currRec.getSublistValue({ sublistId, fieldId: 'so_select', line })
                if (isSelected === true) {
                    const qtyOrder = currRec.getSublistValue({ sublistId, fieldId: 'so_itemqty', line })
                    const qtyNeeded = currRec.getSublistValue({ sublistId, fieldId: 'so_itemqtyneeded', line })
                    const autoQty = Number(qtyOrder) - Number(qtyNeeded)
                    currRec.setCurrentSublistValue({ sublistId, fieldId: 'so_confirmqty',line, value: autoQty > 0 ? autoQty : 0 })
                } else {
                    currRec.setCurrentSublistValue({ sublistId, fieldId: 'so_confirmqty', line, value: '' })
                }
            // }
        }

        if (sublistId === 'soproductqc' && fieldId === 'so_qcselect') {
            const isSelected = currRec.getSublistValue({ sublistId, fieldId: 'so_qcselect', line })
            if (isSelected === true) {
                const qtyOrder = currRec.getSublistValue({ sublistId, fieldId: 'so_qcitemqty', line })
                const qtyNeeded = currRec.getSublistValue({ sublistId, fieldId: 'so_qcitemqtyneeded', line })
                const autoQty = (Number(qtyOrder) || 0) - (Number(qtyNeeded) || 0)
                currRec.setCurrentSublistValue({ sublistId, fieldId: 'so_qcconfirmqty', line, value: autoQty > 0 ? autoQty : 0 })
            } else {
                currRec.setCurrentSublistValue({ sublistId, fieldId: 'so_qcconfirmqty', line, value: '' })
            }
        }
    }

    function saveRecord(context) {
        const currRec = context.currentRecord
        const lineCount = currRec.getLineCount({ sublistId: 'warehousereceiving' })

        for (let i = 0; i < lineCount; i++) {
            const isSelected = currRec.getSublistValue({
                sublistId: 'warehousereceiving',
                fieldId: 'rcv_select',
                line: i
            })
            const qtyValue = currRec.getSublistValue({
                sublistId: 'warehousereceiving',
                fieldId: 'rcv_confirmqty',
                line: i
            })

            if (isSelected === true && !qtyValue) {
                alert('Please enter a Confirm Quantity for selected lines (Line ' + (i + 1) + ')')
                return false
            }
        }
        return true
    }

    function hasSelectedLine(currRec, sublistId, selectFieldId) {
        const lineCount = currRec.getLineCount({ sublistId })

        for (let i = 0; i < lineCount; i++) {
            const isSelected = currRec.getSublistValue({
                sublistId,
                fieldId: selectFieldId[0],
                line: i
            })
            const confirmQty = currRec.getSublistValue({
                sublistId,
                fieldId: selectFieldId[1],
                line: i
            })
            if (isSelected === true && confirmQty) return true
        }
        return false
    }

    function clearSelectedLine(currRec, lines, sublistId, fieldId) {
        lines.forEach(({ line }) => {
            currRec.selectLine({
                sublistId,
                line: line
            })

            currRec.setCurrentSublistValue({
                sublistId,
                fieldId: fieldId[1],
                value: ''
            })

            currRec.setCurrentSublistValue({
                sublistId,
                fieldId: fieldId[0],
                value: false
            })

            currRec.commitLine({
                sublistId
            })
        })
    }

    return {
        pageInit,
        fieldChanged,
        saveRecord,
        handleRcvItems,
        handleQcItems
    }
})