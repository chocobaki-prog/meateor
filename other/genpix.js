import QRCode from "https://esm.sh/qrcode@1.5.3";

export default async function genpix({
  key,
  merchant,
  city,
  amount = "",
  txid = "***",
}) {
  // sanitize to ASCII
  const ascii = s =>
    (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "");

  merchant = ascii(merchant.toUpperCase());
  city = ascii(city.toUpperCase());
  amount = String(amount);
  txid = ascii(txid).slice(0, 25);
  if (!txid) txid = "***";

  const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

  function crc16(payload) {
    let crc = 0xffff;
    for (let c of payload) {
      crc ^= c.charCodeAt(0) << 8;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  // Merchant Account Info (ID 26)
  let mai =
    tlv("00", "BR.GOV.BCB.PIX") +
    tlv("01", key);

  mai = tlv("26", mai);

  // Additional data (ID 62)
  const addData = tlv("62", tlv("05", txid));

  // Build full PIX payload
  const payload =
    tlv("00", "01") +        // Payload format indicator
    tlv("01", "11") +        // POI method = 11 (static)
    mai +
    tlv("52", "0001") +      // MCC
    tlv("53", "986") +       // BRL
    (amount ? tlv("54", amount) : "") +
    tlv("58", "BR") +        // country
    tlv("59", merchant) +    // merchant name
    tlv("60", city) +        // city
    addData +
    "6304";                  // CRC placeholder

  const crc = crc16(payload);
  const fullPayload = payload + crc;

  // Generate QR code → data URL
  return await QRCode.toDataURL(fullPayload, { margin: 1, width: 512 });
};
