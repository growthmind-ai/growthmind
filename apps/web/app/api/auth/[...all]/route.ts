import { getAuth } from "@/lib/auth";

// Better Auth's handler is a web-standard (Request → Response) function, so
// it plugs straight into route handlers. Resolved per request instead of at
// module load — see the note on getAuth().
export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  return getAuth().handler(request);
}
