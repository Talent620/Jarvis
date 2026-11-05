// A public build-time trust root. Private issuer material is never bundled.
// Preserve the existing application issuer; owner installations may provision their own pair.
export const defaultPublicJwk: JsonWebKey = {
  kty: "EC", crv: "P-256",
  x: "cr_zxxKQMLPKsuGybJtd05h_z-m0H_xnhS7WiYtEmdU",
  y: "a1Xl4CHImK2EAIXg19PVIFuagNCa4PQ2zatk4gysxzg",
};
export const PUBLIC_JWK: JsonWebKey = typeof __LICENSE_PUBLIC_JWK__ === "undefined" || !__LICENSE_PUBLIC_JWK__
  ? defaultPublicJwk : __LICENSE_PUBLIC_JWK__;
export const ownerManagedBuild = typeof __LICENSE_PUBLIC_JWK__ !== "undefined" && !!__LICENSE_PUBLIC_JWK__;
export const ownerUpdateMessage = "Ta instalacja korzysta z Twoich licencji. Aktualizuj ją lokalnym instalatorem właściciela, zachowując tę samą parę kluczy.";
