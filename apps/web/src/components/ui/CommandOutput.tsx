import { SEPARATOR } from "../../format";

export function OutputWithCommands({
	commands,
	trace,
	body,
}: {
	commands: string[];
	trace?: string;
	body: React.ReactNode;
}) {
	const traceText = trace?.trim() ?? "";
	return (
		<pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-neutral-100">
			<span className="text-red-400">{commands.join("\n")}</span>
			{"\n"}
			<span className="text-neutral-500">{SEPARATOR}</span>
			{"\n"}
			{body}
			{traceText ? (
				<>
					{"\n"}
					<span className="text-neutral-500">{SEPARATOR}</span>
					{"\n"}
					<span className="text-neutral-500">{traceText}</span>
				</>
			) : null}
		</pre>
	);
}

export function CommandOutputList({
	items,
}: {
	items: Array<{ command: string; output: React.ReactNode; trace?: string }>;
}) {
	return (
		<pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-neutral-100">
			{items.map((item, idx) => (
				<div key={idx}>
					<span className="text-red-400">{item.command}</span>
					{"\n"}
					<span className="text-neutral-500">{SEPARATOR}</span>
					{"\n"}
					{item.output}
					{item.trace ? (
						<>
							{"\n"}
							<span className="text-neutral-500">{SEPARATOR}</span>
							{"\n"}
							<span className="text-neutral-500">{item.trace.trim()}</span>
						</>
					) : null}
					{"\n\n"}
				</div>
			))}
		</pre>
	);
}
