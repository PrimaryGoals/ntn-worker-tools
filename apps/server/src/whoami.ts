import type { Whoami } from "@ntn-worker-tools/shared";
import { runNtnPlainWithTrace } from "./ntn.js";

// `ntn whoami --plain` returns a single tab-separated line:
//   userId  userName  userType  userEmail  spaceId  spaceName  [ownerId  ownerName  ownerType]
// The owner triplet appears when the authenticated principal is a bot / integration.
export async function fetchWhoami(verbose = false): Promise<Whoami> {
	const args = ["whoami"];
	if (verbose) args.push("-v");
	const { stdout, stderr } = await runNtnPlainWithTrace(args);
	const raw = stdout.trim();
	const cols = raw.split("\t");
	if (cols.length < 6) {
		throw new Error(`Unexpected whoami output (${cols.length} cols): ${raw}`);
	}
	const [userId, userName, userType, userEmail, spaceId, spaceName, ownerId, ownerName, ownerType] = cols;
	return {
		userId: userId!,
		userName: userName!,
		userType: userType!,
		userEmail: userEmail || undefined,
		spaceId: spaceId!,
		spaceName: spaceName!,
		ownerId: ownerId || undefined,
		ownerName: ownerName || undefined,
		ownerType: ownerType || undefined,
		...(verbose && stderr ? { _trace: stderr } : {}),
	};
}
