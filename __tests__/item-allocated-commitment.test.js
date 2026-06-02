import record from 'N/record';
import log from 'N/log';
import runtime from 'N/runtime';
import search from 'N/search';

jest.mock('N/record')
jest.mock('N/log')
jest.mock('N/runtime')
jest.mock('N/search')

const { reduce } = require('../src/FileCabinet/SuiteScripts/Item Allocated For Commitment After Approval.js');

/**
 * Build a lightweight mock of a NetSuite record (SO or IF).
 *
 * `fields`       – flat object of body field values  { ordertype: 13, ... }
 * `sublistLines` – array of flat objects per line    [{ itemtype: 'InvtPart', item: 101, ... }]
 *
 * getSublistText('item') returns l['item_text'] if present, else String(l['item']).
 */
function buildRecordMock({ fields = {}, sublistLines = [] } = {}) {
    return {
        getValue: jest.fn(({ fieldId }) =>
            fieldId in fields ? fields[fieldId] : null
        ),
        getText: jest.fn(({ fieldId }) =>
            fields[fieldId + '_text'] ?? String(fields[fieldId] ?? '')
        ),
        setValue: jest.fn(),
        getLineCount: jest.fn(() => sublistLines.length),
        getSublistValue: jest.fn(({ fieldId, line }) => {
            const l = sublistLines[line];
            return l && fieldId in l ? l[fieldId] : null;
        }),
        getSublistText: jest.fn(({ fieldId, line }) => {
            const l = sublistLines[line];
            if (!l) return '';
            return l[fieldId + '_text'] ?? String(l[fieldId] ?? '');
        }),
        setSublistValue: jest.fn(),
        save: jest.fn(() => 9001)
    };
}


/** A single InvtPart SO line — 5 ordered, 0 fulfilled → 5 remaining */
const DEFAULT_SO_LINE = {
    itemtype:           'InvtPart',
    item:               101,
    item_text:          'Widget A',
    quantity:           5,
    quantityfulfilled:  0,
    quantitycommitted:  0,
    quantityavailable:  2,
    commitinventory:    0,
    lineuniquekey:      'key1'
};

/** A single IF line matching the default SO line above */
const DEFAULT_IF_LINE = {
    quantity:       5,
    lineuniquekey:  'key1'
}

/** Build an SO mock with one line. Pass field or line overrides as needed. */
function makeSo(lineOverrides = {}, fieldOverrides = {}) {
    return buildRecordMock({
        fields: {
            ordertype:              13,
            custbody_buy_and_sell:  true,
            tranid:                 'SO-0001',
            ...fieldOverrides
        },
        sublistLines: [{ ...DEFAULT_SO_LINE, ...lineOverrides }]
    });
}

/** Build an IF mock with one line. */
function makeIf(lineOverrides = {}) {
    return buildRecordMock({
        sublistLines: [{ ...DEFAULT_IF_LINE, ...lineOverrides }]
    });
}

describe('Item Allocated For Commitment After Approval', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // Ensure record.Type is available regardless of how the N/record stub initialises
        record.Type = {
            SALES_ORDER:               'salesorder',
            ITEM_FULFILLMENT:          'itemfulfillment',
            INVENTORY_STATUS_CHANGE:   'inventorystatuschange'
        };
    });

    // -----------------------------------------------------------------------
    describe('orderType guard', () => {

        it('does not create a fulfillment when orderType does not match 13', () => {
            record.load.mockReturnValue(makeSo({}, { ordertype: 5 }));

            reduce({ key: '100' });

            expect(record.transform).not.toHaveBeenCalled();
        });

        it('proceeds to fulfillment when orderType is exactly 13', () => {
            record.load.mockReturnValue(makeSo());
            record.transform.mockReturnValue(makeIf());

            reduce({ key: '100' });

            expect(record.transform).toHaveBeenCalledTimes(1);
        });
    });

    // -----------------------------------------------------------------------
    describe('collectEligibleSoItems — line filtering', () => {

        it('collects an InvtPart line that has remaining quantity', () => {
            record.load.mockReturnValue(makeSo());
            record.transform.mockReturnValue(makeIf());

            reduce({ key: '100' });

            expect(record.transform).toHaveBeenCalledTimes(1);
        });

        it('collects a Kit line that has remaining quantity', () => {
            record.load.mockReturnValue(
                makeSo({ itemtype: 'Kit', item: 202, item_text: 'Kit B' })
            );
            record.transform.mockReturnValue(makeIf());

            reduce({ key: '100' });

            expect(record.transform).toHaveBeenCalledTimes(1)
        })

        it('skips a line whose itemType is not InvtPart or Kit (e.g. Service)', () => {
            record.load.mockReturnValue(makeSo({ itemtype: 'Service' }));

            reduce({ key: '100' })

            expect(record.transform).not.toHaveBeenCalled();
        })

        it('skips a line that is already fully fulfilled (qtyRemaining = 0)', () => {
            record.load.mockReturnValue(
                makeSo({ quantity: 5, quantityfulfilled: 5 })
            )

            reduce({ key: '100' });

            expect(record.transform).not.toHaveBeenCalled();
        });

        it('collects a partially fulfilled line where qtyRemaining > 0', () => {
            // 5 ordered, 2 fulfilled → 3 remaining
            record.load.mockReturnValue(
                makeSo({ quantity: 5, quantityfulfilled: 2 })
            );
            record.transform.mockReturnValue(makeIf({ quantity: 3 }));

            reduce({ key: '100' });

            expect(record.transform).toHaveBeenCalledTimes(1);
        });

        it('collects multiple eligible lines from the same SO', () => {
            const soMock = buildRecordMock({
                fields: { ordertype: 13, custbody_buy_and_sell: true, tranid: 'SO-0001' },
                sublistLines: [
                    { ...DEFAULT_SO_LINE, item: 101, item_text: 'Widget A', lineuniquekey: 'key1' },
                    { ...DEFAULT_SO_LINE, item: 202, item_text: 'Widget B', lineuniquekey: 'key2' }
                ]
            });
            const ifMock = buildRecordMock({
                sublistLines: [
                    { quantity: 5, lineuniquekey: 'key1' },
                    { quantity: 5, lineuniquekey: 'key2' }
                ]
            });

            record.load.mockReturnValue(soMock);
            record.transform.mockReturnValue(ifMock);

            reduce({ key: '100' });

            expect(record.transform).toHaveBeenCalledTimes(1);
            // itemreceive=true should have been set for both IF lines
            const trueReceiveCalls = ifMock.setSublistValue.mock.calls.filter(
                ([args]) => args.fieldId === 'itemreceive' && args.value === true
            );
            expect(trueReceiveCalls.length).toBeGreaterThanOrEqual(2);
        });

        it('skips a line with no itemId (item = 0)', () => {
            record.load.mockReturnValue(makeSo({ item: 0 }));

            reduce({ key: '100' });

            expect(record.transform).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    describe('createPackedFulfillment — record.transform args', () => {

        it('calls record.transform with the correct fromId and record types', () => {
            record.load.mockReturnValue(makeSo());
            record.transform.mockReturnValue(makeIf());

            reduce({ key: '123' });

            expect(record.transform).toHaveBeenCalledWith({
                fromType:   record.Type.SALES_ORDER,
                fromId:     123,
                toType:     record.Type.ITEM_FULFILLMENT,
                isDynamic:  false
            });
        });

        it('does not call record.transform when no items pass the filter', () => {
            // All lines fully fulfilled
            record.load.mockReturnValue(
                makeSo({ quantity: 3, quantityfulfilled: 3 })
            );

            reduce({ key: '100' });

            expect(record.transform).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    describe('createPackedFulfillment — fulfillment line setup', () => {

        it('sets shipstatus to "B" on the fulfillment record', () => {
            const ifMock = makeIf();
            record.load.mockReturnValue(makeSo());
            record.transform.mockReturnValue(ifMock);

            reduce({ key: '100' });

            expect(ifMock.setValue).toHaveBeenCalledWith({
                fieldId: 'shipstatus',
                value:   'B'
            });
        });

        it('sets itemreceive = true on the fulfillment line', () => {
            const ifMock = makeIf();
            record.load.mockReturnValue(makeSo());
            record.transform.mockReturnValue(ifMock);

            reduce({ key: '100' });

            expect(ifMock.setSublistValue).toHaveBeenCalledWith(
                expect.objectContaining({ fieldId: 'itemreceive', line: 0, value: true })
            );
        });

        it('uses the full requested quantity when IF default qty exceeds it', () => {
            // 5 ordered, 2 fulfilled → 3 remaining; IF has 10 available
            const ifMock = makeIf({ quantity: 10 });
            record.load.mockReturnValue(
                makeSo({ quantity: 5, quantityfulfilled: 2 })
            );
            record.transform.mockReturnValue(ifMock);

            reduce({ key: '100' });

            // fulfillQty = Math.min(3, 10) = 3
            expect(ifMock.setSublistValue).toHaveBeenCalledWith(
                expect.objectContaining({ fieldId: 'quantity', line: 0, value: 3 })
            );
        });

        it('caps the fulfillment quantity at the IF default when requested qty exceeds it', () => {
            // 10 ordered, 0 fulfilled → 10 remaining; IF only has 4 available
            const ifMock = makeIf({ quantity: 4 });
            record.load.mockReturnValue(
                makeSo({ quantity: 10, quantityfulfilled: 0 })
            );
            record.transform.mockReturnValue(ifMock);

            reduce({ key: '100' });

            // fulfillQty = Math.min(10, 4) = 4
            expect(ifMock.setSublistValue).toHaveBeenCalledWith(
                expect.objectContaining({ fieldId: 'quantity', line: 0, value: 4 })
            );
        });

        it('uses the full requested quantity when IF default qty is 0', () => {
            // IF qty=0 → fulfillQty falls back to requestedQty (5)
            const ifMock = makeIf({ quantity: 0 });
            record.load.mockReturnValue(makeSo({ quantity: 5, quantityfulfilled: 0 }));
            record.transform.mockReturnValue(ifMock);

            reduce({ key: '100' });

            expect(ifMock.setSublistValue).toHaveBeenCalledWith(
                expect.objectContaining({ fieldId: 'quantity', line: 0, value: 5 })
            )
        })
    })
})
