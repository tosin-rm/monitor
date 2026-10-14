import { checkServerIdentity, connect } from "node:tls";
import { nodeDnsLookup } from "@/lib/ssrf/safe-fetch";
import { SsrfError, validateDestination } from "@/lib/ssrf/validate";

export type CertificateInspection = {
  success: boolean;
  handshakeOk: boolean;
  authorized: boolean;
  hostnameMatches: boolean;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  errorCode: string | null;
  sanitizedError: string | null;
};

export function assessCertificate(options: {
  authorized: boolean;
  handshakeOk: boolean;
  hostnameMatches: boolean;
  validFrom: string | null;
  validTo: string | null;
  now: Date;
}): CertificateInspection {
  const validFrom = options.validFrom ? new Date(options.validFrom) : null;
  const validTo = options.validTo ? new Date(options.validTo) : null;
  const notYetValid = Boolean(validFrom && validFrom > options.now);
  const expired = Boolean(validTo && validTo <= options.now);
  const errorCode = !options.hostnameMatches
    ? "hostname_mismatch"
    : expired
      ? "expired"
      : notYetValid
        ? "not_yet_valid"
        : !options.authorized
          ? "untrusted"
          : null;
  return {
    success: options.handshakeOk && options.authorized && options.hostnameMatches && !expired && !notYetValid,
    handshakeOk: options.handshakeOk,
    authorized: options.authorized,
    hostnameMatches: options.hostnameMatches,
    validFrom: validFrom?.toISOString() ?? null,
    validTo: validTo?.toISOString() ?? null,
    daysRemaining: validTo
      ? Math.floor((validTo.getTime() - options.now.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    errorCode,
    sanitizedError: errorCode
      ? errorCode === "hostname_mismatch"
        ? "Certificate hostname does not match"
        : errorCode === "expired"
          ? "Certificate has expired"
          : errorCode === "not_yet_valid"
            ? "Certificate is not yet valid"
            : "Certificate is not trusted"
      : null,
  };
}

export async function inspectCertificate(options: {
  hostname: string;
  now?: Date;
  connectImpl?: typeof connect;
  lookup?: typeof nodeDnsLookup;
}): Promise<CertificateInspection> {
  const now = options.now ?? new Date();
  let hostname: string;
  try {
    const parsed = new URL(options.hostname.includes("://") ? options.hostname : `https://${options.hostname}`);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port && parsed.port !== "443") {
      throw new Error("Invalid certificate hostname");
    }
    hostname = parsed.hostname;
  } catch {
    return {
      success: false,
      handshakeOk: false,
      authorized: false,
      hostnameMatches: false,
      validFrom: null,
      validTo: null,
      daysRemaining: null,
      errorCode: "invalid_hostname",
      sanitizedError: "Hostname is invalid for certificate inspection",
    };
  }
  let destination;
  try {
    destination = await validateDestination(`https://${hostname}`, options.lookup ?? nodeDnsLookup, 5_000);
  } catch (error) {
    const code = error instanceof SsrfError ? error.code : "network_failure";
    return {
      success: false,
      handshakeOk: false,
      authorized: false,
      hostnameMatches: false,
      validFrom: null,
      validTo: null,
      daysRemaining: null,
      errorCode: code,
      sanitizedError: error instanceof SsrfError && error.code === "timeout"
        ? "DNS lookup timed out during certificate inspection"
        : "Hostname could not be safely validated for certificate inspection",
    };
  }

  return await new Promise((resolve) => {
    const socket = (options.connectImpl ?? connect)({
      host: destination.addresses[0]!.address,
      servername: hostname,
      port: 443,
      rejectUnauthorized: true,
    });
    const finish = (result: CertificateInspection) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(15000, () => {
      finish({
        success: false,
        handshakeOk: false,
        authorized: false,
        hostnameMatches: false,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        errorCode: "timeout",
        sanitizedError: "TLS handshake timed out",
      });
    });
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      finish(assessCertificate({
        authorized: socket.authorized,
        handshakeOk: true,
        hostnameMatches: !checkServerIdentity(hostname, cert),
        validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
        validTo: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
        now,
      }));
    });
    socket.once("error", (error: NodeJS.ErrnoException & { code?: string }) => {
      const code = error.code ?? "tls_error";
      const cert = socket.getPeerCertificate();
      const hasCertificate = Object.keys(cert).length > 0;
      const hostnameMatches = hasCertificate
        ? !checkServerIdentity(hostname, cert)
        : code !== "ERR_TLS_CERT_ALTNAME_INVALID";
      const inspection = assessCertificate({
        authorized: false,
        handshakeOk: false,
        hostnameMatches,
        validFrom: hasCertificate && cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
        validTo: hasCertificate && cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
        now,
      });
      if (code === "CERT_HAS_EXPIRED") {
        inspection.errorCode = "expired";
        inspection.sanitizedError = "Certificate has expired";
      } else if (inspection.errorCode === "untrusted") {
        inspection.errorCode = code;
        inspection.sanitizedError = "TLS handshake failed";
      }
      finish(inspection);
    });
  });
}
