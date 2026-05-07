const data = [{"id":145003,"status":"Pending Fulfillment","isMainRelease":false,"items":
    [{"item":"TDL-VIS-A","itemid":926,"qtyOrder":20,"qtyFulfilled":null,"qtyCommitted":0,"qtyPrepared":0,"prepStage":"","isStage":false,"isLineRelease":false,"commitInventory":"3","lineUniqueKey":"1513139"},{"item":"TDL-VIS-A-ALT","itemid":53771,"qtyOrder":12,"qtyFulfilled":null,"qtyCommitted":11,"qtyPrepared":0,"prepStage":"","isStage":false,"isLineRelease":false,"commitInventory":"","lineUniqueKey":"1513140"}]}]	

data.forEach(d => {
    const items = d.items
    items.forEach(i => {
        if (i.commitInventory === "3") {
            i.isLineRelease = true
        }
    })
    console.log({data: d, item: items})
})
