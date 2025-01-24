declare global {
	namespace NodeJS {
		interface ProcessEnv {
			TEST_API_KEY: string;
		}
	}
}

console.log(`${process.env.TEST_API_KEY || "Failed to load .env"}`);
