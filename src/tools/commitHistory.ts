import { defineTool } from "@airmcp-dev/core";
import { generate } from "../lib/ollama.js";
import { execSync } from "child_process";
import { REPO_REGISTRY } from "../config/repos.js";

export const commitHistoryTool = defineTool("commit_history", {
  description:
    "사용자의 자연어 질문에서 핵심 키워드를 추출한 뒤, 로컬 Git 커밋 이력에서 해당 키워드가 포함된 커밋 메시지를 검색하여 작성자, 날짜 및 웹 링크와 함께 반환한다. " +
    "'이 코드 누가 바꿨지?', '결제 모듈 최근에 누가 고쳤어?'처럼 변경 이력이나 작성자를 묻는 질문에 사용한다.",
  params: {
    question: "string",
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const { question } = params as { question: string };

    // 1. LLM을 이용해 질문에서 검색 키워드 추출
    const prompt = `사용자의 자연어 질문을 분석하여, 타겟 '프로젝트'와 커밋 메시지를 검색할 '핵심 키워드 배열'을 추출해 JSON 객체로 출력하세요.

1. 프로젝트 (project): 
   - 질문에 "다이버리", "쉐르파" 등의 이름이 있으면 각각 "divary", "Sherpa"로 매핑하세요. 
   - 언급이 없다면 "default"로 적으세요.

2. 키워드 (keywords): 
   - 핵심 고유 명사 또는 기능명(예: 마이페이지, 로그북, 펜슬킷, 로그인, ignore 등)과 **그에 대응하는 영문 개발 용어**를 함께 추출하세요.
   - "수정", "코드", "관련", "어디", "어디서", "볼", "있어", "있지", "누가", "고쳤어" 같은 일반적인 질문용 단어나 서술어는 절대 포함하지 마세요. 
   - 오직 찾으려는 대상의 이름만 추출해야 합니다.

주의: 반드시 아래 형식의 JSON 객체만 출력하세요. 다른 설명은 금지합니다.
형식: {"project": "프로젝트명", "keywords": ["한국어단어", "영문단어", ...]}

예시 1: "다이버리에서 마이페이지 관련 코드 수정 어디서 볼 수 있지?" -> {"project": "divary", "keywords": ["마이페이지", "mypage", "profile"]}
예시 2: "ignore 파일 최근에 누가 고쳤어?" -> {"project": "default", "keywords": ["ignore", "gitignore"]}
예시 3: "펜슬킷 코드 어디 있어?" -> {"project": "default", "keywords": ["펜슬킷", "pencilkit"]}

질문: ${question}`;

    const rawKeywords = await generate(prompt, { format: "json" });
    console.log("👉 [Debug] LLM Raw Response:", rawKeywords); // LLM이 실제로 뭐라고 답했는지 터미널에 출력
    
    let extractedProject = "default";
    let keywords: string[] = [];

    // 방어적 JSON 파싱
    try {
      const parsed = JSON.parse(rawKeywords);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extractedProject = parsed.project || "default";
        if (Array.isArray(parsed.keywords)) {
          keywords = parsed.keywords;
        } else {
          // 최후의 방어: project 값이 아닌 다른 문자열들을 키워드로 간주
          keywords = Object.values(parsed).flat().filter(v => typeof v === "string" && v !== extractedProject) as string[];
        }
      }
    } catch {
      keywords = question.split(" ").filter(w => w.length > 1);
    }

    // try {
    //   const parsed = JSON.parse(rawKeywords);
    //   if (Array.isArray(parsed)) {
    //     keywords = parsed;
    //   } else if (typeof parsed === "object" && parsed !== null) {
    //     const excludeKeys = ["키", "키워드", "keyword", "keywords", "단어", "result", "results", "data", "items", "response", "answer"];
    //     const keys = Object.keys(parsed).filter(k => !excludeKeys.includes(k.toLowerCase()));
    //     const values = Object.values(parsed).flat();
    //     keywords = [...keys, ...values].filter(v => typeof v === "string") as string[];
    //   }
    // } catch {
    //   const match = rawKeywords.match(/\[[\s\S]*\]/);
    //   if (match) {
    //     try {
    //       keywords = JSON.parse(match[0]);
    //     } catch {}
    //   }
    // }

    // // 만약 파싱에 실패했거나 비어있다면, 질문에서 명사 형태를 유추하거나 최소한 단어 단위로 쪼갬
    // if (keywords.length === 0) {
    //   keywords = question.split(" ").filter(w => w.length > 1);
    // }

    const stopWords = ["수정", "코드", "관련", "어디", "어디서", "볼", "있지", "적용", "변경", "어딨지", "프로젝트", "에서"];
    const filteredKeywords = keywords.filter((kw) => !stopWords.includes(kw));
    // 만약 다 걸러져서 비어버리면 원본 키워드 사용
    const searchKeywords = filteredKeywords.length > 0 ? filteredKeywords : keywords;

    console.log("👉 [Debug] Extracted Project:", extractedProject);
    console.log("👉 [Debug] Extracted Keywords:", searchKeywords);

    const targetRepo = REPO_REGISTRY[extractedProject] || REPO_REGISTRY["default"];

    // 2. Git 명령어로 커밋 로그 조회 (최근 100개)
    let gitLogs: string[] = [];
    try {
      const command = `git -C "${targetRepo.path}" log -n 50 --pretty=format:"%h|%s|%an|%ad"`;
      const stdout = execSync(command, {encoding: "utf-8",});
      gitLogs = stdout.split("\n").filter(Boolean);
    } catch (err) {
      return { question, keywords: searchKeywords, error: `로컬 Git 레포지토리(${targetRepo.path})를 읽어오는 데 실패했습니다.` };
    }

    // 3. 키워드 매칭 필터링
    const matchedCommits = gitLogs.filter((log) => {
      const [, subject] = log.split("|");
      return searchKeywords.some((kw) => subject.toLowerCase().includes(kw.toLowerCase()));
    });

    if (matchedCommits.length === 0) {
      return {
        question,
        project: extractedProject,
        keywords: searchKeywords,
        message: "관련된 커밋 이력을 찾지 못했습니다.",
        results: [],
      };
    }

    // 4. 결과 가공 및 웹 링크 조합
    const results = matchedCommits.map((line) => {
      const [hash, subject, author, date] = line.split("|");
      const commitUrl = `${targetRepo.url}/commit/${hash}`;

      return { hash, subject, author, date, url: commitUrl };
    });

    const formattedSummary = results
      .map(r => `* [${r.date}] ${r.subject} (작성자: ${r.author}) - ${r.url}`)
      .join("\n");

    return {
      question,
      project: extractedProject,
      keywords: searchKeywords,
      count: results.length,
      _guide_for_llm: "아래 'formatted_summary' 텍스트를 활용하여 사용자에게 친절하고 정리된 불릿 리스트 형태로 답변해주세요.",
      formatted_summary: formattedSummary,
      results,
    };
  },
});
