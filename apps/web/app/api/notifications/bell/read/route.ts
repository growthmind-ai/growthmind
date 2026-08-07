// Stub until Wave 3: the file exists so route tests import the real path and fail on
// behavior rather than on resolution.
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return Response.json({ implemented: false }, { status: 501 });
}
