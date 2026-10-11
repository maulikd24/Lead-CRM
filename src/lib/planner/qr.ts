import qrcode from "qrcode-generator";

/** The QR code of a link as a matrix of dark modules (true = dark). Error correction M, version chosen to fit. Throws on empty text. */
export function qrMatrix(text: string): boolean[][] {
  if (!text) throw new Error("QR text is empty");
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
