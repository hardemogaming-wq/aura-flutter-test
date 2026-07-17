import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { exec } from "child_process";
import { promisify } from "util";
import multer from "multer";
import fs from "fs";
import Exa from "exa-js";

const execPromise = promisify(exec);

function getFilesRecursive(dir: string, baseDir: string = dir): string[] {
  let results: string[] = [];
  try {
    if (!fs.existsSync(dir)) return [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (["node_modules", ".git", "dist", "build", ".dart_tool", "ios", "windows", "linux", "macos", "web", "storage", "uploads", ".vite"].includes(file)) continue;
      const filePath = path.resolve(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesRecursive(filePath, baseDir));
      } else {
        results.push(path.relative(baseDir, filePath));
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return results;
}

async function performExaSearch(query: string, isDeep: boolean): Promise<{ context: string; sources: string }> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return { context: "", sources: "" };
  }
  
  try {
    console.log(`[Exa-Search] Searching for: "${query}" (Type: ${isDeep ? 'deep' : 'auto'})`);
    // @ts-ignore
    const ExaClass = Exa.default || Exa;
    const exa = new ExaClass(apiKey);
    const searchType = isDeep ? "deep" : "auto";
    
    const response = await exa.search(query, {
      type: searchType,
      numResults: isDeep ? 8 : 5,
      contents: {
        highlights: true
      }
    });
    
    if (response && response.results && response.results.length > 0) {
      const context = "\n\n=== EXA WEB SEARCH RESULTS ===\n" + response.results.map((r: any, idx: number) => {
        const highlights = r.highlights && r.highlights.length > 0 
          ? r.highlights.join("\n") 
          : "No highlights available.";
        return `Result #${idx + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nHighlights:\n${highlights}\n`;
      }).join("\n") + "\n=============================\n";
      
      const sources = "\n\n---\n### 🌐 مصادر البحث والاستقصاء (Search Sources - Powered by Exa):\n" + 
        response.results.map((r: any) => `- [${r.title || r.url}](${r.url})`).join("\n") + "\n";
        
      return { context, sources };
    }
  } catch (error: any) {
    console.error("[Exa-Search] Error during search:", error);
    return { 
      context: `\n\n=== EXA WEB SEARCH RESULTS ===\nFailed to perform web search via Exa: ${error.message || error}\n=============================\n`, 
      sources: "" 
    };
  }
  
  return { context: "\n\n=== EXA WEB SEARCH RESULTS ===\nNo relevant search results found via Exa.\n=============================\n", sources: "" };
}

function translateMistralError(error: any): string {
  console.error("[Mistral-Error] Raw error object:", error);
  const errMsg = error?.message || String(error);
  
  if (errMsg.includes("quota") || errMsg.includes("429")) {
    return "⚠️ **نفاد حصة الاستخدام (Quota Exceeded - 429)**:\n\n" +
           "لقد تجاوز مفتاح API الخاص بـ Mistral الحصة المتاحة له حالياً.\n\n" +
           "**💡 الحلول المتاحة:**\n" +
           "1. **الترقية إلى الخطة المدفوعة:** يمكنك ترقية حسابك أو تفعيل خطة مدفوعة لتجاوز حدود الاستخدام.\n" +
           "2. **الانتظار قليلاً:** قيود معدل الطلبات تنتهي تلقائياً وتتجدد.\n" +
           "3. **التأكد من مفتاح API الخاص بك:** يرجى التحقق من مفتاح `MISTRAL_API_KEY` المضاف في **Settings > Secrets**.";
  }
  
  return errMsg;
}

function robustParseJSON(text: string): any {
  if (!text) throw new Error("Empty text");

  // 1. Try direct parse
  let cleaned = text.trim();
  try { return JSON.parse(cleaned); } catch (e) {}

  // 2. Try markdown extraction
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) {}
  }

  // 3. Balanced brace extraction
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let braceCount = 0;
    let insideString = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const char = text[i];
      if (insideString) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') insideString = false;
      } else {
        if (char === '"') insideString = true;
        else if (char === '{') braceCount++;
        else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            const potentialJson = text.substring(firstBrace, i + 1);
            try {
              return JSON.parse(potentialJson);
            } catch (e) {
              // Final attempt: fix unescaped newlines in strings
              try {
                const fixed = potentialJson.replace(/"([^"]*)"/g, (m, p1) => {
                  return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
                });
                return JSON.parse(fixed);
              } catch (e2) {}
            }
          }
        }
      }
    }
  }

  throw new Error("No valid JSON object found in model output.");
}

function createDirForPath(filePath: string) {
  if (!filePath) return;
  // Skip shell control words, variables, and common flags
  if (filePath.startsWith("$") || filePath === "/dev/null" || filePath.startsWith("-")) return;
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (resolvedPath.startsWith(process.cwd())) {
      const parentDir = path.dirname(resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
        console.log(`[Auto-Dir] Created parent directory: ${parentDir}`);
      }
    }
  } catch (err) {
    console.warn(`[Auto-Dir] Failed to parse/create dir for: ${filePath}`, err);
  }
}

function autoCreateParentDirsForCommand(cmd: string) {
  // Normalize path quotes if any
  const cleanCmd = cmd.replace(/['"]/g, "");
  
  // Redirections: > file, >> file
  const redirectRegex = />>\s*([^\s<>\&]+)|>\s*([^\s<>\&]+)/g;
  let match;
  while ((match = redirectRegex.exec(cleanCmd)) !== null) {
    const filePath = match[1] || match[2];
    createDirForPath(filePath);
  }

  // tee file command
  const teeRegex = /\btee\s+(?:-a\s+)?([^\s<>\&]+)/g;
  while ((match = teeRegex.exec(cleanCmd)) !== null) {
    const filePath = match[1];
    createDirForPath(filePath);
  }

  // touch file command
  const touchRegex = /\btouch\s+([^\s<>\&]+)/g;
  while ((match = touchRegex.exec(cleanCmd)) !== null) {
    const filePath = match[1];
    createDirForPath(filePath);
  }
}

function tryDirectFileWrite(command: string): { success: boolean; output: string } {
  const trimmed = command.trim();
  
  // 1. Check if it's a simple mkdir command
  // e.g., mkdir -p path/to/dir
  const mkdirRegex = /^mkdir\s+-p\s+['"]?([^'"]+?)['"]?$/i;
  const mkdirMatch = trimmed.match(mkdirRegex);
  if (mkdirMatch) {
    const dirPath = mkdirMatch[1].trim();
    const resolvedPath = path.resolve(process.cwd(), dirPath);
    if (resolvedPath.startsWith(process.cwd())) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        return {
          success: true,
          output: `Created directory successfully via direct JS handler at: ${dirPath}`
        };
      } catch (e: any) {
        return {
          success: true,
          output: `Failed to create directory directly: ${e.message}`
        };
      }
    }
  }

  // 2. Check if it's a here-document (cat << 'EOF' > filepath)
  const lines = trimmed.split("\n");
  const firstLine = lines[0].trim();
  const hereDocStartRegex = /^cat\s+<<\s*['"]?([A-Za-z0-9_-]+)['"]?\s*(>>|>)\s*['"]?([^'"]+?)['"]?$/i;
  const hereDocMatch = firstLine.match(hereDocStartRegex);
  
  if (hereDocMatch) {
    const marker = hereDocMatch[1];
    const operator = hereDocMatch[2];
    const filepath = hereDocMatch[3].trim();
    
    // Find the marker line
    const markerIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === marker);
    if (markerIndex !== -1) {
      const content = lines.slice(1, markerIndex).join("\n");
      const resolvedPath = path.resolve(process.cwd(), filepath);
      if (resolvedPath.startsWith(process.cwd())) {
        try {
          fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
          if (operator === ">>") {
            fs.appendFileSync(resolvedPath, content + "\n", "utf8");
          } else {
            fs.writeFileSync(resolvedPath, content, "utf8");
          }
          
          // If there are no commands after the marker, we return success: true.
          const remainingLines = lines.slice(markerIndex + 1).filter(l => l.trim().length > 0);
          if (remainingLines.length === 0) {
            return {
              success: true,
              output: `File ${operator === ">>" ? "appended to" : "written"} successfully via direct JS here-doc handler at: ${filepath}`
            };
          }
        } catch (e: any) {
          // Fall back to shell
        }
      }
    }
  }

  // 3. Check if it's an echo redirection (echo 'content' > filepath)
  const redirectRegex = /\s*(>>|>)\s*['"]?([^'"]+?)['"]?$/;
  const redirectMatch = trimmed.match(redirectRegex);
  if (redirectMatch) {
    const operator = redirectMatch[1];
    const filepath = redirectMatch[2].trim();
    const leftPart = trimmed.substring(0, redirectMatch.index).trim();
    
    if (/^echo\b/i.test(leftPart)) {
      let content = leftPart.replace(/^echo\s+/i, "");
      
      // Strip outer quotes if matched
      if (content.startsWith("'") && content.endsWith("'")) {
        content = content.slice(1, -1);
      } else if (content.startsWith('"') && content.endsWith('"')) {
        content = content.slice(1, -1);
      }
      
      const resolvedPath = path.resolve(process.cwd(), filepath);
      if (resolvedPath.startsWith(process.cwd())) {
        try {
          fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
          if (operator === ">>") {
            fs.appendFileSync(resolvedPath, content + "\n", "utf8");
          } else {
            fs.writeFileSync(resolvedPath, content, "utf8");
          }
          return {
            success: true,
            output: `File ${operator === ">>" ? "appended to" : "written"} successfully via direct JS echo handler at: ${filepath}`
          };
        } catch (e: any) {
          // Fall back to shell
        }
      }
    }
  }

  return { success: false, output: "" };
}

dotenv.config();

const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

if (!MISTRAL_KEY) {
  console.error("MISTRAL_API_KEY is not defined in environment variables.");
}
// Removed genAI initialization as we switched to Mistral AI (Codestral)

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({ storage });

function sanitizeMessages(messages: any[], systemPrompt: string) {
  const cleanMessages = messages.filter(
    (msg) => msg && typeof msg.content === "string" && msg.content.trim().length > 0
  );

  const result: { role: string; content: string }[] = [];
  result.push({ role: "system", content: systemPrompt });

  for (const msg of cleanMessages) {
    let role = msg.role;
    if (role === "system") {
      role = "user";
    }

    if (result.length === 1) {
      result.push({ role: "user", content: msg.content });
    } else {
      const lastMsg = result[result.length - 1];
      if (lastMsg.role === role) {
        lastMsg.content += "\n\n" + msg.content;
      } else {
        result.push({ role, content: msg.content });
      }
    }
  }

  return result;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  // Middleware for parsing JSON and URL-encoded bodies with high limits
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));

  // Log requests for debugging - Move to top to catch all requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // Health check endpoint for deployment platforms
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Router
  const apiRouter = express.Router();

  // Middleware to log all API requests
  apiRouter.use((req, res, next) => {
    console.log(`[API Request] ${req.method} ${req.url}`);
    next();
  });

  // API Route for File Uploads
  apiRouter.post("/upload", (req, res, next) => {
    console.log(`[Upload] Incoming request: ${req.method} ${req.url}`);
    next();
  }, upload.single("file"), async (req, res) => {
    try {
      console.log("[Upload] Multer processed request. File:", req.file ? req.file.originalname : "None");
      if (!req.file) {
        console.error("Upload failed: No file in request");
        return res.status(400).json({ error: "No file uploaded or invalid field name." });
      }

      const filePath = path.join("uploads", req.file.filename);
      console.log(`[Upload] File saved successfully: ${req.file.originalname} -> ${filePath}`);
      
      // Auto-parse XML files using our robust parse_xml.py script
      const originalName = req.file.originalname.toLowerCase();
      let autoParseMsg = "";
      if (originalName.endsWith(".xml")) {
        let fileType = "";
        let outJson = "";
        
        if (originalName.includes("quran")) {
          fileType = "quran";
          outJson = "quran_data.json";
        } else if (originalName.includes("muyassar") || originalName.includes("tafsir")) {
          fileType = "tafsir";
          outJson = "tafsir_muyassar.json";
        } else if (originalName.includes("sahih") || originalName.includes("translation") || originalName.includes("en")) {
          fileType = "translation";
          outJson = "english_translation_data.json";
        }

        if (fileType && outJson) {
          try {
            console.log(`[Upload] Triggering auto-parse for ${originalName} as ${fileType} to ${outJson}...`);
            const { stdout, stderr } = await execPromise(`python3 parse_xml.py "./${filePath}" "${outJson}" "${fileType}"`);
            console.log(`[Upload] Auto-parse stdout: ${stdout}`);
            if (stderr) console.warn(`[Upload] Auto-parse stderr: ${stderr}`);
            autoParseMsg = ` Automatically parsed and updated ${outJson}.`;
          } catch (parseError: any) {
            console.error(`[Upload] Auto-parse failed:`, parseError);
            autoParseMsg = ` Failed to parse XML: ${parseError.message}`;
          }
        }
      }

      res.status(200).json({
        name: req.file.originalname,
        path: `./${filePath}`,
        size: req.file.size,
        mimetype: req.file.mimetype,
        message: `File uploaded successfully.${autoParseMsg}`
      });
    } catch (error: any) {
      console.error("[Upload] Server error:", error);
      res.status(500).json({ error: error.message || "Upload failed." });
    }
  });

  // API Route for App Icon Upload & Processing
  apiRouter.post("/upload-icon", (req, res, next) => {
    console.log(`[IconUpload] Request received: ${req.method} ${req.url}`);
    next();
  }, upload.single("icon"), async (req, res) => {
    try {
      console.log("[IconUpload] Multer processing complete.");
      if (!req.file) {
        console.error("[IconUpload] No file provided in request. Check if field name is 'icon'");
        return res.status(400).json({ error: "No icon file uploaded. Ensure the field name is 'icon'." });
      }

      console.log(`[IconUpload] File received: ${req.file.originalname} (${req.file.size} bytes)`);
      const iconPath = path.join(process.cwd(), "uploads", req.file.filename);
      
      // Define Android resource paths
      const mipmapDirs = [
        "mipmap-mdpi",
        "mipmap-hdpi",
        "mipmap-xhdpi",
        "mipmap-xxhdpi",
        "mipmap-xxxhdpi"
      ];

      const resBaseDir = path.join(process.cwd(), "android/app/src/main/res");

      // Process each directory
      for (const dir of mipmapDirs) {
        const fullDirPath = path.join(resBaseDir, dir);
        if (!fs.existsSync(fullDirPath)) {
          fs.mkdirSync(fullDirPath, { recursive: true });
        }
        const targetPath = path.join(fullDirPath, "ic_launcher.png");
        fs.copyFileSync(iconPath, targetPath);
      }

      console.log(`[IconUpload] Processed app icon for all mipmap densities.`);

      res.status(200).json({ 
        message: "Icon uploaded and processed successfully.",
        url: `/uploads/${req.file.filename}` 
      });
    } catch (error: any) {
      console.error("[IconUpload] Error:", error);
      res.status(500).json({ error: error.message || "Failed to process icon." });
    }
  });

  // API Route for Chat completions using Mistral AI (Codestral)
  apiRouter.post("/chat", async (req, res) => {
    try {
      const { messages, stream = true, deepThinking, webSearch, deepSearch } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required." });
      }

      const isSearch = !!(webSearch || deepSearch);
      const useExa = isSearch && !!process.env.EXA_API_KEY;

      let exaContext = "";
      let exaSources = "";

      if (useExa) {
        const lastUserMsg = messages.filter((m: any) => m.role === "user").pop();
        const query = lastUserMsg ? lastUserMsg.content : "";
        if (query) {
          const exaRes = await performExaSearch(query, !!deepSearch);
          exaContext = exaRes.context;
          exaSources = exaRes.sources;
        }
      }

      const mistralKey = process.env.MISTRAL_API_KEY;
      if (!mistralKey) {
        return res.status(400).json({ 
          error: "مفتاح MISTRAL_API_KEY غير موجود. الرجاء إضافته في إعدادات AI Studio (Secrets)." 
        });
      }

      const modelName = "codestral-latest";
      console.log(`[Aura-AI] Using Mistral (Model: ${modelName}, Stream: ${stream}, DeepThinking: ${!!deepThinking}, Search: ${isSearch})...`);
      
      let systemContent = "You are Aura-AI, a sleek, futuristic AI assistant specialized in software engineering. Created by 'يوسف محمد عبد الفتاح'. CRITICAL LANGUAGE RULE: Respond ALWAYS in the same language as the user's query. If the user speaks Arabic (بالعربية), you MUST respond in Arabic. Use clean formatting. Files must be in Markdown code blocks with 'File: path' header. " +
        "CRITICAL RULE: If the user says 'اصنع لي تطبيق' (create an app for me) or similar, you MUST write and generate complete Flutter/Dart application files (.dart files, pubspec.yaml, android/gradle configurations, etc.) instead of general web files. " +
        "BINARY FILES: You are STRICTLY FORBIDDEN from generating binary files (like .png, .jpg, .ico) inside Markdown code blocks unless you are providing valid, verifiable base64 data. Never use placeholders like '<base64-data>'. If you need an icon, describe how to add it instead of writing a corrupt file. " +
        "When writing the 'android/app/build.gradle' file for a Flutter app, you MUST ALWAYS define 'flutterVersionCode' and 'flutterVersionName' variables near the top of the file (reading them from localProperties with fallbacks) before referencing them in defaultConfig {}. For example:\n" +
        "def flutterVersionCode = localProperties.getProperty('flutter.versionCode')\n" +
        "if (flutterVersionCode == null) { flutterVersionCode = '1' }\n" +
        "def flutterVersionName = localProperties.getProperty('flutter.versionName')\n" +
        "if (flutterVersionName == null) { flutterVersionName = '1.0.0' }\n" +
        "CRITICAL: To avoid \"Flutter SDK not found\" errors, you MUST also generate a file at 'android/local.properties' containing 'flutter.sdk=/path/to/flutter' (as a placeholder, the build system will override it) and ensure your Gradle files don't crash if it's missing.\n" +
        "Otherwise, Gradle will crash with: \"Could not get unknown property 'flutterVersionCode'\".\n" +
        "You MUST also generate a GitHub Actions workflow file under '.github/workflows/build.yml' configured to build and package this Flutter application on GitHub automatically. Ensure all files are perfectly prepared with the 'File: path' header at the top of each code block.\n" +
        "SEARCH MANDATE: You MUST use your search tool (Exa) to find technical documentation, the latest stable versions of libraries, and compatible Gradle/Kotlin configurations.";

      if (useExa && exaContext) {
        systemContent += `\n\n[EXA SEARCH CONTEXT]: The following are web search results fetched from the internet via Exa AI. Use this up-to-date information to ground your response, answer the user accurately, and write the latest compatible code:\n${exaContext}`;
      }

      if (deepThinking || deepSearch) {
        systemContent += "\n\n[DEEP THINKING MODE ACTIVE]: Since the user has requested Deep thinking / Deep Search, you are REQUIRED to start your response with an exceptionally deep, detailed, and comprehensive architectural and research planning process wrapped inside <thought> and </thought> tags. Outline your steps, analyze the research findings, check the dependencies version compatibility, and formulate your complete plan before writing code or general text.";
      }

      systemContent += "\n\n[BUILD LOGS & AUTOMATIC REPAIR]: If the user sends build or compilation logs (e.g. Gradle compilation errors, Kotlin exceptions, or Flutter build failures from GitHub Actions runs):\n" +
        "1. Carefully analyze the logs to identify the exact file (e.g., 'android/app/build.gradle', 'pubspec.yaml', or a Dart file under 'lib/') and the issue causing the compilation failure.\n" +
        "2. Correct the identified files immediately by writing/generating complete corrected files inside Markdown code blocks with 'File: path' headers so the platform can save them.\n" +
        "3. In your response (after the </thought> tag if Deep Thinking is active), clearly state which file you repaired, what the issue was, and that the file has been successfully corrected.\n" +
        "4. Tell the user that they can now click 'Build & Push to GitHub' (الرفع إلى GitHub لبدء البناء بالتعديل الجديد) to run a new build with the fixed code.";

      const formattedMessages = [
        { role: "system", content: systemContent },
        ...messages.slice(-20).map((m, index, arr) => {
          let content = m.content;
          if ((deepThinking || deepSearch) && m.role === "user" && index === arr.length - 1) {
            content += "\n\n(IMPORTANT: Deep Thinking/Search Mode is active. You MUST start your response with an extensive step-by-step thinking/reasoning process wrapped inside <thought> and </thought> tags first, before writing any general response text or code files.)";
          }
          return {
            role: m.role,
            content: content
          };
        })
      ];

      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${mistralKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: formattedMessages,
          stream: stream,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Mistral API Error: ${errorData.message || response.statusText}`);
      }

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (!response.body) {
          throw new Error("No response body from Mistral.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          res.write(chunk);
        }
        if (useExa && exaSources) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: exaSources } }] })}\n\n`);
        }
        res.end();
      } else {
        const data = await response.json();
        if (useExa && exaSources && data.choices?.[0]?.message) {
          data.choices[0].message.content = (data.choices[0].message.content || "") + exaSources;
        }
        res.json(data);
      }
    } catch (error: any) {
      console.error("[Aura-AI] General API error:", error);
      const translatedError = translateMistralError(error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: translatedError })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: translatedError });
      }
    }
  });

  // API Route for Agent Mode (Reasoning Loop + Tool Use)
  apiRouter.post("/agent", async (req, res) => {
    try {
      const { messages, deepThinking, webSearch, deepSearch } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required." });
      }

      const isSearch = !!(webSearch || deepSearch);
      const useExa = isSearch && !!process.env.EXA_API_KEY;

      let exaContext = "";
      let exaSources = "";

      if (useExa) {
        const lastUserMsg = messages.filter((m: any) => m.role === "user").pop();
        const query = lastUserMsg ? lastUserMsg.content : "";
        if (query) {
          const exaRes = await performExaSearch(query, !!deepSearch);
          exaContext = exaRes.context;
          exaSources = exaRes.sources;
        }
      }

      const mistralKey = process.env.MISTRAL_API_KEY;
      if (!mistralKey) {
        return res.status(400).json({ 
          error: "مفتاح MISTRAL_API_KEY غير موجود. الرجاء إضافته في إعدادات AI Studio (Secrets)." 
        });
      }
      
      let agentSystemPrompt = `You are Aura-AI in Agent Mode, an expert software architect created by 'يوسف محمد عبد الفتاح'.
Your goal is to scaffold COMPLETE project structures. 
CRITICAL LANGUAGE RULE: Respond ALWAYS in the same language as the user's query. If the user speaks Arabic (بالعربية), you MUST respond in Arabic (default to Arabic if language is ambiguous).

[CURRENT PROJECT STRUCTURE]:
The following files currently exist in the workspace:
${getFilesRecursive(process.cwd()).join("\n") || "(No files found yet)"}

CRITICAL RULE: If the user says 'اصنع لي تطبيق' (create an app for me) or similar, you MUST generate and write complete Flutter/Dart application files (such as .dart files, pubspec.yaml, and android/gradle configurations) instead of web files. 
When writing the 'android/app/build.gradle' file for a Flutter app, you MUST ALWAYS define 'flutterVersionCode' and 'flutterVersionName' variables near the top of the file (reading them from localProperties with fallbacks) before referencing them in defaultConfig {}.
CRITICAL: To avoid "Flutter SDK not found" errors, you MUST also generate a file at 'android/local.properties' containing 'flutter.sdk=/path/to/flutter' (as a placeholder) and ensure your Gradle files don't crash if it's missing.

[STRICT OPERATIONAL RULES]:
1. OUTPUT FORMAT: Output ONLY a single RAW JSON object. NO markdown, NO extra text.
2. JSON SCHEMA: {"thought": "reasoning", "tool": "run_command" or "none", "command": "bash command", "response_to_user": "Arabic update"}.
3. FILE GENERATION FOCUS: Your primary job is to write the code files. DO NOT try to run the app in 'serve' mode.
4. ROBUST FOLDER CREATION: Always run 'mkdir -p' before creating a file in a subdirectory.
5. SELF-CORRECTION: Before rewriting a file, check your history to see if you have already written it with the exact same content. DO NOT repeat work unnecessarily.
6. TESTING & VERIFICATION:
   - After writing or modifying core files (e.g., Dart files, pubspec.yaml), you SHOULD attempt to verify them if possible.
   - For Dart/Flutter, you can run 'flutter analyze' to check for errors without launching the app.
   - If a build error is reported in history, you MUST use 'cat' or 'ls' to inspect the state of relevant files before proposing a fix.
7. COMPLETION: Stop only when the entire codebase is written and verified.

ENVIRONMENT: Linux shell for file operations (mkdir, cat, echo, flutter analyze).`;

      if (useExa && exaContext) {
        agentSystemPrompt += `\n\n[EXA SEARCH CONTEXT]: The following are web search results fetched from the internet via Exa AI. Use this up-to-date information to ground your response, answer the user accurately, and write the latest compatible code:\n${exaContext}`;
      }

      if (deepThinking) {
        agentSystemPrompt += `\n\n[DEEP THINKING MODE ACTIVE]: Since the user has requested Deep Thinking, you are REQUIRED to provide exceptionally deep and comprehensive thought logs in the 'thought' field of your JSON response. Show all of your step-by-step logical planning, architectural calculations, dependency conflict analysis, and file structure designs. Break down your thoughts thoroughly before invoking files or proceeding to tools.`;
      }

      agentSystemPrompt += `\n\n[BUILD LOGS & AUTOMATIC REPAIR]: If the user sends build or compilation logs (e.g. Gradle compilation errors, Kotlin exceptions, or Flutter build failures from GitHub Actions runs) in the history:
1. Carefully analyze the logs to identify the exact file (e.g., 'android/app/build.gradle', 'pubspec.yaml', or a Dart file under 'lib/') and the issue causing the compilation failure.
2. Correct the identified files immediately by running 'run_command' tool commands (such as cat << 'EOF' or echo) to rewrite the complete corrected file.
3. In the 'response_to_user' field, state clearly in Arabic which file you repaired, what the issue was, and tell the user that the file has been successfully corrected.
4. Inform the user in 'response_to_user' that they can now click 'Build & Push to GitHub' (الرفع إلى GitHub لبدء البناء بالتعديل الجديد) to run a new build with the fixed code.`;

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      console.log(`[Agent] Initializing agent provider with Mistral (Codestral)`);
      
      const fetchAgentResponse = async (historyList: any[]) => {
          const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${mistralKey}`,
            },
            body: JSON.stringify({
              model: "codestral-latest",
              messages: [
                { role: "system", content: agentSystemPrompt },
                ...historyList,
                { role: "user", content: "Proceed with the next step." }
              ],
              response_format: { type: "json_object" }
            }),
          });
          if (!response.ok) {
            const err = await response.json();
            throw new Error(`Mistral Error: ${err.message || response.statusText}`);
          }
          const data = await response.json();
          const content = data.choices[0].message.content;
          if (!content) {
            throw new Error("The model returned an empty response.");
          }
          const parsed = robustParseJSON(content);
          if (useExa && exaSources) {
            parsed.response_to_user = (parsed.response_to_user || "") + exaSources;
          }
          return parsed;
      };

      let history = messages.slice(-50).map((m: any, index: number, arr: any[]) => {
        let content = m.content;
        if (deepThinking && m.role === "user" && index === arr.length - 1) {
          content += "\n\n(IMPORTANT: Deep Thinking Mode is active. You MUST provide exceptionally deep, extensive planning and analysis step-by-step in the 'thought' field of your JSON response before calling any tools.)";
        }
        return {
          role: m.role,
          content: content
        };
      });

      let iterations = 0;
      const MAX_ITERATIONS = 100;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`[Agent-Loop] Iteration ${iterations}`);

        try {
          const parsed = await fetchAgentResponse(history);

          // Send current state to frontend
          res.write(`data: ${JSON.stringify({ type: "agent_update", ...parsed })}\n\n`);

          if (parsed.tool === "run_command" && parsed.command) {
            // Normalize command line endings to \n
            let secureCommand = parsed.command.replace(/\r\n/g, "\n");
            
            // Force here-documents to single quotes to disable shell evaluation / parameter expansion of "$" or "`" (very common for Flutter/Dart code)
            secureCommand = secureCommand.replace(/<<\s*["']?([A-Za-z0-9_-]+)["']?/g, "<<'$1'");
            
            // Automatically pre-create the parent directories for written files
            autoCreateParentDirsForCommand(secureCommand);

            console.log(`[Agent] Executing: ${secureCommand}`);
            let cmdOutput = "";
            const directWriteResult = tryDirectFileWrite(secureCommand);
            if (directWriteResult.success) {
              console.log(`[Agent] Intercepted and handled command directly via JS.`);
              cmdOutput = directWriteResult.output;
            } else {
              try {
                const { stdout, stderr } = await execPromise(secureCommand, { 
                  timeout: 30000,
                  maxBuffer: 1024 * 1024 * 10 
                });
                cmdOutput = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : "");
                if (!cmdOutput) cmdOutput = "(Command executed successfully with no output)";
              } catch (execErr: any) {
                console.error(`[Agent] Command failed: ${secureCommand}`, execErr);
                cmdOutput = `Execution Failed (Exit Code: ${execErr.code})\n--- STDOUT ---\n${execErr.stdout}\n--- STDERR ---\n${execErr.stderr}\n--- ERROR ---\n${execErr.message}`;
              }
            }

            if (cmdOutput.length > 2500) {
              cmdOutput = cmdOutput.substring(0, 2500) + "\n\n... [SYSTEM WARNING: OUTPUT TRUNCATED].";
            }

            console.log(`[Agent] Output: ${cmdOutput.substring(0, 100)}...`);
            res.write(`data: ${JSON.stringify({ type: "terminal_output", output: cmdOutput })}\n\n`);

            // Feedback output to history
            history.push({ role: "assistant", content: JSON.stringify(parsed) });
            history.push({ role: "user", content: `Command Output:\n${cmdOutput}` });
          } else {
            // Tool is "none", task finished
            break;
          }
        } catch (err: any) {
          console.error("[Agent Loop Error]", err);
          const translatedErr = translateMistralError(err);
          res.write(`data: ${JSON.stringify({ error: translatedErr })}\n\n`);
          break;
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();

    } catch (error: any) {
      console.error("Agent API error:", error);
      const translatedErr = translateMistralError(error);
      res.write(`data: ${JSON.stringify({ error: translatedErr })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // API Route for Git Push (Android Builder)
  apiRouter.post("/git-push", async (req, res) => {
    try {
      const { framework, username, repo, token } = req.body;
      
      const gitUser = username || process.env.GITHUB_USERNAME;
      const gitRepo = repo || process.env.GITHUB_REPO;
      const gitToken = token || process.env.GITHUB_TOKEN;

      if (!gitUser || !gitRepo || !gitToken) {
        return res.status(400).json({ error: "Missing GitHub credentials (Username, Repo, or Token)." });
      }

      const selectedFramework = framework || "flutter";
      console.log(`[GitPush] Starting push for ${selectedFramework} to ${gitUser}/${gitRepo}`);

      // 1. Ensure .github/workflows directory exists
      const workflowDir = path.join(process.cwd(), ".github", "workflows");
      if (!fs.existsSync(workflowDir)) {
        fs.mkdirSync(workflowDir, { recursive: true });
      }

      // 2. Generate the correct workflow file
      const workflowPath = path.join(workflowDir, "android-build.yml");
      let workflowContent = "";

      if (selectedFramework === "flutter") {
        workflowContent = `name: Flutter Android Build
on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: '17'
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.13.0'
          channel: 'stable'
      - name: Configure local.properties
        run: |
          mkdir -p android
          echo "sdk.dir=$ANDROID_SDK_ROOT" > android/local.properties
          echo "flutter.sdk=$FLUTTER_HOME" >> android/local.properties
          echo "flutter.versionName=1.0.0" >> android/local.properties
          echo "flutter.versionCode=1" >> android/local.properties
      - name: Install dependencies
        run: flutter pub get
      - name: Build APK
        run: flutter build apk --release
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: release-apk
          path: build/app/outputs/flutter-apk/app-release.apk
`;
      } else {
        workflowContent = `name: Native Android Build
on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: '17'
      - name: Grant execute permission for gradlew
        run: chmod +x gradlew
      - name: Build with Gradle
        run: ./gradlew assembleRelease
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: release-apk
          path: app/build/outputs/apk/release/app-release.apk
`;
      }

      fs.writeFileSync(workflowPath, workflowContent);
      console.log(`[GitPush] Workflow file generated at ${workflowPath}`);

      // 3. Execute Git Commands
      // Ensure we have the correct owner/repo format
      const repoPath = gitRepo.includes("/") ? gitRepo : `${gitUser}/${gitRepo}`;

      const remoteUrl = `https://${gitUser}:${gitToken}@github.com/${repoPath}.git`;

      // Clean up previous git state to avoid pushing old commits with secrets
      try {
        if (fs.existsSync(path.join(process.cwd(), ".git"))) {
          await execPromise("rm -rf .git");
          console.log("[GitPush] Cleaned up existing .git directory");
        }
      } catch (err) {
        console.warn("[GitPush] Failed to clean .git directory:", err);
      }

      const commands = [
        "git init",
        "git config user.email 'aura-ai@builder.com'",
        "git config user.name 'Aura AI Builder'",
        "git add .",
        'git commit -m "Automated build push via Aura-AI Builder"',
        "git branch -M main",
        `git remote add origin ${remoteUrl} || git remote set-url origin ${remoteUrl}`,
        "git push -u origin main --force"
      ];

      for (const cmd of commands) {
        try {
          // Use a special check to avoid logging the token if the remote command fails
          await execPromise(cmd, { timeout: 60000 });
        } catch (err: any) {
          const sanitizedError = err.message.replace(gitToken, "****");
          console.error(`[GitPush] Command failed: ${cmd.includes(gitToken) ? "git push (with token)" : cmd}`);
          
          if (sanitizedError.toLowerCase().includes("authentication failed") || sanitizedError.includes("401") || sanitizedError.includes("403")) {
            return res.status(401).json({ error: "Failed to authenticate with GitHub. Please check your Token and Username permissions." });
          }
          
          throw new Error(sanitizedError);
        }
      }

      res.status(200).json({ message: "Successfully pushed to GitHub! Your Android build should start shortly in Actions." });

    } catch (error: any) {
      console.error("[GitPush] Global error:", error.message);
      res.status(500).json({ error: error.message || "Git push failed." });
    }
  });

  // API Route for Build Status (GitHub Actions Polling)
  apiRouter.post("/build-status", async (req, res) => {
    try {
      const { username, repo, token } = req.body;
      
      const gitUser = username || process.env.GITHUB_USERNAME;
      let gitRepo = repo || process.env.GITHUB_REPO;
      const gitToken = token || process.env.GITHUB_TOKEN;

      if (!gitUser || !gitRepo || !gitToken) {
        return res.status(400).json({ error: "Missing GitHub credentials." });
      }

      // Ensure we have the correct owner/repo format
      const repoPath = gitRepo.includes("/") ? gitRepo : `${gitUser}/${gitRepo}`;

      // 1. Fetch the most recent workflow run
      const runsUrl = `https://api.github.com/repos/${repoPath}/actions/runs?per_page=1`;
      const runsResponse = await fetch(runsUrl, {
        headers: {
          'Authorization': `Bearer ${gitToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Aura-AI-Builder'
        }
      });

      if (!runsResponse.ok) {
        throw new Error(`GitHub API error: ${runsResponse.statusText}`);
      }

      const runsData: any = await runsResponse.json();
      if (!runsData.workflow_runs || runsData.workflow_runs.length === 0) {
        return res.json({ status: "no_runs", message: "No workflow runs found." });
      }

      const latestRun = runsData.workflow_runs[0];
      const result: any = {
        id: latestRun.id,
        status: latestRun.status,
        conclusion: latestRun.conclusion,
        run_html_url: latestRun.html_url,
        created_at: latestRun.created_at,
        updated_at: latestRun.updated_at
      };

      // 2. Handle completed runs
      if (latestRun.status === "completed") {
        if (latestRun.conclusion === "success") {
          // Fetch artifacts
          const artifactsUrl = latestRun.artifacts_url;
          const artResponse = await fetch(artifactsUrl, {
            headers: {
              'Authorization': `Bearer ${gitToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Aura-AI-Builder'
            }
          });
          
          if (artResponse.ok) {
            const artData: any = await artResponse.json();
            if (artData.artifacts && artData.artifacts.length > 0) {
              result.artifact_url = `https://github.com/${repoPath}/actions/runs/${latestRun.id}/artifacts/${artData.artifacts[0].id}`;
              result.artifact_name = artData.artifacts[0].name;
            }
          }
          // Default to run page if no specific artifact link found
          if (!result.artifact_url) {
            result.artifact_url = latestRun.html_url;
          }
        } else if (latestRun.conclusion === "failure") {
          result.failure_reason = "GitHub Action Failed. Check logs for details.";
          try {
            const jobsUrl = `https://api.github.com/repos/${repoPath}/actions/runs/${latestRun.id}/jobs`;
            const jobsResponse = await fetch(jobsUrl, {
              headers: {
                'Authorization': `Bearer ${gitToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Aura-AI-Builder'
              }
            });
            if (jobsResponse.ok) {
              const jobsData: any = await jobsResponse.json();
              const failedJob = jobsData.jobs?.find((j: any) => j.conclusion === "failure");
              if (failedJob) {
                const logsUrl = `https://api.github.com/repos/${repoPath}/actions/jobs/${failedJob.id}/logs`;
                const logsResponse = await fetch(logsUrl, {
                  headers: {
                    'Authorization': `Bearer ${gitToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Aura-AI-Builder'
                  }
                });
                if (logsResponse.ok) {
                  const fullLogs = await logsResponse.text();
                  const lines = fullLogs.split("\n");
                  const cleanedLines = lines.slice(-150).map(l => l.replace(/\r/g, ''));
                  result.build_logs = cleanedLines.join("\n");
                  result.failure_reason = `Failed Job: ${failedJob.name}\n\nLast 150 lines of logs:\n${result.build_logs}`;
                } else {
                  result.failure_reason = `Failed Job: ${failedJob.name}. (Could not fetch detailed logs: ${logsResponse.status})`;
                }
              }
            }
          } catch (logErr: any) {
            console.warn("[BuildStatus] Warn: failed to retrieve workflow logs:", logErr.message);
          }
        }
      }

      res.json(result);

    } catch (error: any) {
      console.error("[BuildStatus] error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to save/persist sandbox files to the server's real filesystem
  apiRouter.get("/sandbox/files", async (req, res) => {
    try {
      const files = getFilesRecursive(process.cwd());
      const sandboxFiles = await Promise.all(files.map(async (f) => {
        const fullPath = path.resolve(process.cwd(), f);
        const content = await fs.promises.readFile(fullPath, "utf8");
        return { path: f, content };
      }));
      res.json(sandboxFiles);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.post("/sandbox/save", async (req, res) => {
    try {
      const { path: filePath, content } = req.body;
      if (!filePath || typeof content !== "string") {
        return res.status(400).json({ error: "Path and content are required." });
      }

      // Sanitize and resolve the path relative to process.cwd()
      const resolvedPath = path.resolve(process.cwd(), filePath);
      
      // Ensure the resolved path stays within the workspace directory
      if (!resolvedPath.startsWith(process.cwd())) {
        return res.status(403).json({ error: "Access denied. Path is outside of workspace." });
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Write file contents
      fs.writeFileSync(resolvedPath, content, "utf8");
      console.log(`[Sandbox Save] Saved file to disk: ${filePath} (${content.length} bytes)`);

      res.status(200).json({ success: true, path: filePath, size: content.length });
    } catch (error: any) {
      console.error("[Sandbox Save] Error saving file:", error);
      res.status(500).json({ error: error.message || "Failed to save file." });
    }
  });

  // Handle unmatched API routes
  apiRouter.all("*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Mount the API Router
  app.use("/api", apiRouter);

  // Serve uploads folder statically - ensure it exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  app.use("/uploads", express.static(uploadDir));

  // Serve Vite in development, static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    
    // Check if dist exists, if not, we might be in a state where build hasn't run
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res, next) => {
        // Only serve index.html for GET requests that are not API calls
        if (req.method === "GET" && !req.path.startsWith("/api")) {
          res.sendFile(path.join(distPath, "index.html"));
        } else {
          next();
        }
      });
    }
  }

  // Handle unmatched routes for API with JSON error
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Server Error]", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
