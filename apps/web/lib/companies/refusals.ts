const SIGNED_OUT_MESSAGE = "Sign in to see your companies.";

export function signedOutRefusal(code: "signed_out"): Response {
  return Response.json({ code, message: SIGNED_OUT_MESSAGE }, { status: 401 });
}
