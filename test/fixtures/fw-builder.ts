import { BLOCKS, BlockCode } from '../../src/mevne-ahid/blocks';

/**
 * בונה שורת Fixed-Width תקנית לפי פריסת ה-BlockDef — מבטיח יישור offsets נכון
 * (בניית fixture ידנית מועדת לשגיאות).
 */
export function fwLine(code: BlockCode, fields: Record<string, string>): string {
  const block = BLOCKS[code];
  const buf = Array(block.recordWidth).fill(' ');
  for (let i = 0; i < code.length; i++) buf[i] = code[i];
  for (const fd of block.fields) {
    const val = (fields[fd.name] ?? '').toString();
    for (let i = 0; i < fd.width; i++) {
      buf[fd.offset + i] = i < val.length ? val[i] : ' ';
    }
  }
  return buf.join('');
}

/** קובץ Fixed-Width שקול לוגית ל-sample.mevne-ahid.xml. */
export function sampleFixedWidthFile(): string {
  return [
    fwLine('010', { inquiryNumber: 'INQ-2024-0001', fileDate: '20240520', providerCode: 'PASEL', standardVersion: '2024.1' }),
    fwLine('020', { lotId: 'L1', israelId: '000000018', firstName: 'Israel', lastName: 'Israeli', birthDate: '19850312', gender: 'M', city: 'TLV' }),
    fwLine('030', { lotId: 'L1', manufacturerCode: 'CLAL', manufacturerName: 'Clal' }),
    fwLine('040', { lotId: 'L1', manufacturerCode: 'CLAL', policyNumber: 'FW-200', productCode: 'GEMEL', openedDate: '20160601', accountStatus: 'AC', riskTrackCode: 'STOCK' }),
    fwLine('050', { lotId: 'L1', policyNumber: 'FW-200', snapshotDate: '20240430', severance: '50000.00', tagmulimEmployee: '30000.00', tagmulimEmployer: '40000.00', allowance: '0.00' }),
    fwLine('060', { lotId: 'L1', policyNumber: 'FW-200', coverageTypeCode: 'DISAB', insuredAmount: '300000.00', premium: '90.00', underwritingStatus: 'OK', coverageFrom: '20160601' }),
    fwLine('070', { lotId: 'L1', policyNumber: 'FW-200', employerCompanyId: '000000026', employerName: 'Acme', employmentStart: '20180101', depositMonth: '202404', amountEmployee: '1000.00', amountEmployer: '1200.00', amountSeverance: '1400.00' }),
    fwLine('080', { lotId: 'L1', policyNumber: 'FW-200', beneficiaryName: 'Dana', relation: 'SPOUSE', sharePercent: '100.00' }),
    fwLine('090', { lotId: 'L1', policyNumber: 'FW-200', movementType: 'LN', movementDate: '20230901', gross: '20000.00', loanExternalId: 'LN9' }),
    fwLine('999', { recordCount: '9', checksum: 'OK' }),
  ].join('\n');
}
