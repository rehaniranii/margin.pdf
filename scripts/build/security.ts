// Shared by the production HTML, local preview, service-worker responses and
// generated static-host header instructions. React uses inline styles for geometry.
export const CONTENT_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
export const SECURITY_HEADERS: Record<string,string> = {
  'Content-Security-Policy': `${CONTENT_POLICY}; frame-ancestors 'none'`,
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}
