import path from 'node:path';

export class PdfValidationError extends Error {
  code: 'invalid-pdf-bytes' | 'pdf-type-mismatch' | 'pdf-size-mismatch';
  documentName: string;
  path: string;
  reason: string;

  constructor({
    code,
    documentName,
    path: repoPath,
    reason,
  }: {
    code: PdfValidationError['code'];
    documentName: string;
    path: string;
    reason: string;
  }) {
    super(`Invalid PDF artifact: ${documentName} ${reason}. Re-upload or replace this document.`);
    this.name = 'PdfValidationError';
    this.code = code;
    this.documentName = documentName;
    this.path = repoPath;
    this.reason = reason;
  }
}

const normalizeContentType = (contentType: string | undefined) => contentType?.toLowerCase().split(';')[0]?.trim();

export const validatePublishPdfBytes = ({
  bytes,
  contentType,
  expectedSizeBytes,
  filename,
  path: repoPath,
}: {
  bytes: Buffer;
  contentType?: string;
  expectedSizeBytes?: number;
  filename?: string;
  path: string;
}) => {
  const documentName = filename || repoPath;
  const normalizedContentType = normalizeContentType(contentType);
  const extension = path.extname(repoPath).toLowerCase();

  if (normalizedContentType && normalizedContentType !== 'application/pdf') {
    throw new PdfValidationError({
      code: 'pdf-type-mismatch',
      documentName,
      path: repoPath,
      reason: `declared unsupported content type ${normalizedContentType}`,
    });
  }

  if (extension && extension !== '.pdf') {
    throw new PdfValidationError({
      code: 'pdf-type-mismatch',
      documentName,
      path: repoPath,
      reason: 'must use a .pdf file extension',
    });
  }

  if (expectedSizeBytes !== undefined && bytes.byteLength !== expectedSizeBytes) {
    throw new PdfValidationError({
      code: 'pdf-size-mismatch',
      documentName,
      path: repoPath,
      reason: `size ${bytes.byteLength} bytes did not match expected ${expectedSizeBytes} bytes`,
    });
  }

  if (bytes.subarray(0, 5).toString('utf8') !== '%PDF-') {
    throw new PdfValidationError({
      code: 'invalid-pdf-bytes',
      documentName,
      path: repoPath,
      reason: 'bytes must start with %PDF-',
    });
  }
};
