// VietQR = the NAPAS profile of the EMVCo merchant-presented QR format.
// Building the payload locally means no third-party QR service sees the
// order codes; any Vietnamese banking app can scan the result.
//
// Layout (tag, length, value), per the NAPAS VietQR spec:
//   00 payload format "01" · 01 "12" (dynamic, single-use amount)
//   38 merchant account: 00 GUID "A000000727", 01 beneficiary {00 BIN, 01 account},
//      02 service "QRIBFTTA" (transfer to bank account)
//   53 currency "704" (VND) · 54 amount · 58 country "VN"
//   62 additional data: 08 purpose of transaction (= transfer memo)
//   63 CRC-16/CCITT-FALSE over everything up to and including "6304"
const NAPAS_GUID = "A000000727";
const SERVICE_TO_ACCOUNT = "QRIBFTTA";

function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new Error(`VietQR field ${tag} is too long`);
  return tag + String(value.length).padStart(2, "0") + value;
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface VietQrInput {
  bankBin: string;
  accountNo: string;
  amountVnd: number;
  memo: string;
}

export function buildVietQrPayload({ bankBin, accountNo, amountVnd, memo }: VietQrInput): string {
  if (!/^\d{6}$/.test(bankBin)) throw new Error("VietQR bank BIN must be 6 digits");
  if (!/^[A-Za-z0-9]{1,19}$/.test(accountNo)) throw new Error("VietQR account number must be 1-19 letters/digits");
  if (!Number.isInteger(amountVnd) || amountVnd <= 0) throw new Error("VietQR amount must be a positive integer (VND)");

  const beneficiary = tlv("00", bankBin) + tlv("01", accountNo);
  const merchantAccount = tlv("00", NAPAS_GUID) + tlv("01", beneficiary) + tlv("02", SERVICE_TO_ACCOUNT);
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("38", merchantAccount) +
    tlv("53", "704") +
    tlv("54", String(amountVnd)) +
    tlv("58", "VN") +
    tlv("62", tlv("08", memo)) +
    "6304";
  return body + crc16(body);
}
