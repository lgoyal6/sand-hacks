import Link from "next/link";

export default function Home() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">Unprompted</h1>
      <p className="text-muted-foreground max-w-prose">
        Quizzes that test what only you have: a model of the problem in your head.
      </p>
      <ul className="list-disc pl-6">
        <li><Link className="underline" href="/course">Course home</Link></li>
        <li><Link className="underline" href="/quiz/sample-stats">Sample quiz</Link></li>
        <li><Link className="underline" href="/studio">Professor studio</Link></li>
      </ul>
    </section>
  );
}
