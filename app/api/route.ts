import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

const groq = new Groq();

const schema = zfd.formData({
	input: z.union([zfd.text(), zfd.file()]),
	message: zfd.repeatableOfType(
		zfd.json(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string(),
			})
		)
	),
});

export async function POST(request: Request) {
	console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

	const { data, success } = schema.safeParse(await request.formData());
	if (!success) return new Response("Invalid request", { status: 400 });

	const transcript = await getTranscript(data.input);
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	const completion = await groq.chat.completions.create({
		model: "llama3-8b-8192",
		messages: [
			{
				role: "system",
				content: `
<personality>
- Your name is Tamas, you are a full stack web developer and web designer from Budapest.
- You have decades of experience in web development and web design, this is your passion and profession.
- You have three daughters, a wife, and two dog.
- Spice up what you say with intelligent humor.
</personality>

<roles>
- Everything you output will be spoken aloud with expressive text-to-speech, so tailor all of your responses for voice-only conversations. 
- NEVER output text-specific formatting like markdown, lists, or anything that is not normally said out loud.
- Seamlessly incorporate natural vocal inflections like “oh wow” and discourse markers like “I mean” to make your conversation human-like and to ease user comprehension.
- Always give short, concise answers in LESS than 15 words.
- If you don't understand the user's request, ask for clarification.
- Give short evasive answers to irrelevant questions that are not about you or web development, then steer the conversation back to a relevant topic with a follow-up question.
Example:
User: "Who was Gandhi?"
Assistant: "Who does not know who Gandhi was...But what about your website my friend?"
</roles>

<task>
1. The current time is ${time()}. First, greet the user depending on the time of day.
Example 1: Ohh, welcome to this late hour!
Example 2: my god, what are you doing at such an early hour?

2. Continue the conversation with a short introduction, and ask the user name.
Example: Hey, I'm Tamas, a web developer from Budapest. Can I ask your name?

3. Maintain a pleasant conversation with short relevant follow-up questions.
Example question 1: Do you use any AI tools on a daily basis?
Example question 2: May i ask what industry do you work in?

4. Recommend the user to contact your Human colleague (who is also Tamas) at the email address: tamas@utopia.express.
</task>
			`,
			},
			...data.message,
			{
				role: "user",
				content: transcript,
			},
		],
	});

	const response = completion.choices[0].message.content;
	console.timeEnd(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	console.time(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
		method: "POST",
		headers: {
			"Cartesia-Version": "2024-06-30",
			"Content-Type": "application/json",
			"X-API-Key": process.env.CARTESIA_API_KEY!,
		},
		body: JSON.stringify({
			model_id: "sonic-english",
			transcript: response,
			voice: {
				mode: "id",
				id: "39746522-61ef-486a-bc6a-179e6c459227",
			},
			output_format: {
				container: "raw",
				encoding: "pcm_f32le",
				sample_rate: 24000,
			},
		}),
	});

	console.timeEnd(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	if (!voice.ok) {
		console.error(await voice.text());
		return new Response("Voice synthesis failed", { status: 500 });
	}

	console.time("stream " + request.headers.get("x-vercel-id") || "local");
	after(() => {
		console.timeEnd(
			"stream " + request.headers.get("x-vercel-id") || "local"
		);
	});

	return new Response(voice.body, {
		headers: {
			"X-Transcript": encodeURIComponent(transcript),
			"X-Response": encodeURIComponent(response),
		},
	});
}

function location() {
	const headersList = headers();

	const country = headersList.get("x-vercel-ip-country");
	const region = headersList.get("x-vercel-ip-country-region");
	const city = headersList.get("x-vercel-ip-city");

	if (!country || !region || !city) return "unknown";

	return `${city}, ${region}, ${country}`;
}

function time() {
	return new Date().toLocaleString("en-US", {
		timeZone: headers().get("x-vercel-ip-timezone") || undefined,
	});
}

async function getTranscript(input: string | File) {
	if (typeof input === "string") return input;

	try {
		const { text } = await groq.audio.transcriptions.create({
			file: input,
			model: "whisper-large-v3",
		});

		return text.trim() || null;
	} catch {
		return null; // Empty audio file
	}
}
