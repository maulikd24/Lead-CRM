export function GateBlockerList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {messages.map((message) => (
        <p key={message} className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}
