const SIGNED_OUT_MESSAGE = "Sign in to see your companies.";

export function companiesListRefusal(code: "signed_out"): Response {
  return Response.json({ code, message: SIGNED_OUT_MESSAGE }, { status: 401 });
}

export function companiesDetailRefusal(code: "signed_out"): Response {
  return Response.json({ code, message: SIGNED_OUT_MESSAGE }, { status: 401 });
}
