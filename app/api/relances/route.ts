import { NextResponse } from "next/server";
import { soumissionsARelancer } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await soumissionsARelancer());
}
