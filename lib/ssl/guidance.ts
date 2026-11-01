export type CertificateGuidance = {
  status: "invalid" | "unconfirmed" | "valid";
  title: string;
  action: string;
};

const CERTIFICATE_ERRORS: Record<string, { title: string; action: string }> = {
  expired: {
    title: "Certificate reported expired",
    action: "Renew or reissue the certificate, install it on the origin/CDN, and verify that every serving host presents the renewed certificate.",
  },
  CERT_HAS_EXPIRED: {
    title: "Certificate reported expired",
    action: "Renew or reissue the certificate, install it on the origin/CDN, and verify that every serving host presents the renewed certificate.",
  },
  hostname_mismatch: {
    title: "Certificate hostname does not match",
    action: "Compare the monitored hostname with the certificate names (including www vs. apex); check which certificate the origin, proxy, or CDN serves for that hostname.",
  },
  not_yet_valid: {
    title: "Certificate is not yet valid",
    action: "Check the certificate start date and the server clock, then confirm the newly deployed certificate is active.",
  },
  untrusted: {
    title: "Certificate is not trusted",
    action: "Install the complete certificate chain from a trusted issuer; check for a missing intermediate or a self-signed certificate.",
  },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: {
    title: "Certificate chain could not be verified",
    action: "Install the complete certificate chain from a trusted issuer; check for a missing intermediate certificate.",
  },
  DEPTH_ZERO_SELF_SIGNED_CERT: {
    title: "Certificate is self-signed",
    action: "Replace it with a certificate from a publicly trusted issuer, or confirm that this hostname is intentionally internal.",
  },
  SELF_SIGNED_CERT_IN_CHAIN: {
    title: "Certificate chain contains a self-signed certificate",
    action: "Check the origin/CDN certificate configuration and install the complete chain from a trusted issuer.",
  },
};

export function certificateGuidance(errorCode: string | null, success: boolean): CertificateGuidance {
  if (success) {
    return {
      status: "valid",
      title: "TLS check passed",
      action: "The monitor completed a trusted TLS handshake for this hostname at the time shown.",
    };
  }
  const knownProblem = errorCode ? CERTIFICATE_ERRORS[errorCode] : undefined;
  if (knownProblem) return { status: "invalid", ...knownProblem };
  return {
    status: "unconfirmed",
    title: "Monitor could not confirm the certificate",
    action: "This result alone does not prove the certificate is invalid. Check the hostname/DNS and whether port 443 is reachable, then compare with the next monitor check; a browser may use a different network path.",
  };
}

export function isConfirmedCertificateProblem(errorCode: string | null): boolean {
  return Boolean(errorCode && CERTIFICATE_ERRORS[errorCode]);
}
