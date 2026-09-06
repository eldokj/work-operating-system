import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">AI Task Manager</h1>
        <p className="max-w-md text-slate-500">
          Personal, team, and institution-wide task management — built to work without AI,
          with AI as an optional layer on top.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/login" className="btn-primary">
          Log in
        </Link>
        <Link href="/signup" className="btn-secondary">
          Create an account
        </Link>
      </div>
    </main>
  );
}
