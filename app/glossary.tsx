import { GLOSSARY } from './plain.js';

/** 업무 용어 짧은 풀이(접어 둔다). */
export function Glossary() {
  return (
    <details className="more glossary">
      <summary>용어 풀이</summary>
      <dl>
        {GLOSSARY.map(([term, text]) => (
          <div key={term}><dt>{term}</dt><dd>{text}</dd></div>
        ))}
      </dl>
    </details>
  );
}
