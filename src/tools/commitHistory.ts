import { defineTool } from "@airmcp-dev/core";
import { generate } from "../lib/ollama.js";
import { execSync } from "child_process";

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
    const prompt = `사용자의 자연어 질문에서 커밋 메시지를 검색할 **핵심 고유 명사 또는 기능명(예: 마이페이지, 로그북, 펜슬킷, 로그인 등)과 그에 대응하는 영문 개발 용어**만 추출하여 JSON 배열 형태로 출력하세요.
"수정", "코드", "관련", "어디", "어디서", "볼", "있어" 같은 일반적인 질문용 단어는 절대 포함하지 마세요. 오직 찾으려는 대상의 이름만 추출해야 합니다.

주의: 반드시 대괄호로 둘러싸인 1차원 배열(Array) 형태로만 출력하세요. 객체(Object) 형태는 허용하지 않습니다.
다른 설명은 하지 말고 오직 JSON 배열만 출력하세요.

예시 1: "마이페이지 관련 코드 수정 어디서 볼 수 있지?" -> ["마이페이지", "mypage", "profile"]
예시 3: "ignore 파일 최근에 누가 고쳤어?" -> ["ignore", "gitignore", "mod", "update", "fix", "chore"]
예시 4: "펜슬킷 코드 어디 있어?" -> ["펜슬킷", "pencilkit"]

질문: ${question}`;

    const rawKeywords = await generate(prompt, { format: "json" });
    console.log("👉 [Debug] LLM Raw Response:", rawKeywords); // LLM이 실제로 뭐라고 답했는지 터미널에 출력
    
    let keywords: string[] = [];
    try {
      const parsed = JSON.parse(rawKeywords);
      if (Array.isArray(parsed)) {
        keywords = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        const excludeKeys = ["키", "키워드", "keyword", "keywords", "단어", "result", "results", "data", "items", "response", "answer"];
        const keys = Object.keys(parsed).filter(k => !excludeKeys.includes(k.toLowerCase()));
        const values = Object.values(parsed).flat();
        keywords = [...keys, ...values].filter(v => typeof v === "string") as string[];
      }
    } catch {
      const match = rawKeywords.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          keywords = JSON.parse(match[0]);
        } catch {}
      }
    }

    // 만약 파싱에 실패했거나 비어있다면, 질문에서 명사 형태를 유추하거나 최소한 단어 단위로 쪼갬
    if (keywords.length === 0) {
      keywords = question.split(" ").filter(w => w.length > 1);
    }

    const stopWords = ["수정", "코드", "관련", "어디", "어디서", "볼", "있어", "적용", "변경"];
    const filteredKeywords = keywords.filter((kw) => !stopWords.includes(kw));
    // 만약 다 걸러져서 비어버리면 원본 키워드 사용
    const searchKeywords = filteredKeywords.length > 0 ? filteredKeywords : keywords;

    console.log("👉 [Debug] Extracted Search Keywords:", searchKeywords);

    // 2. Git 명령어로 커밋 로그 조회 (최근 100개)
    let gitLogs: string[] = [];
    try {
      const repoPath = "/Users/kimnayoung/work/source/divary-iOS";
      const command = `git -C "${repoPath}" log -n 100 --pretty=format:"%h|%s|%an|%ad"`;
      const stdout = execSync(command, {encoding: "utf-8",});
      gitLogs = stdout.split("\n").filter(Boolean);
    } catch (err) {
      return { question, keywords, error: "로컬 Git 레포지토리를 읽어오는 데 실패했습니다." };
    }

    // 3. 키워드 매칭 필터링
    const matchedCommits = gitLogs.filter((log) => {
      const [, subject] = log.split("|");
      return searchKeywords.some((kw) => subject.toLowerCase().includes(kw.toLowerCase()));
    });

    if (matchedCommits.length === 0) {
      return {
        question,
        keywords: searchKeywords,
        message: "관련된 커밋 이력을 찾지 못했습니다.",
        results: [],
      };
    }

    // 4. 결과 가공 및 웹 링크 조합
    const results = matchedCommits.map((line) => {
      const [hash, subject, author, date] = line.split("|");
      const commitUrl = `https://github.com/DivaryOfficial/divary-iOS/commit/${hash}`;

      return { hash, subject, author, date, url: commitUrl };
    });

    const formattedSummary = results
      .map(r => `* [${r.date}] ${r.subject} (작성자: ${r.author}) - ${r.url}`)
      .join("\n");

    return {
      question,
      keywords: searchKeywords,
      count: results.length,
      _guide_for_llm: "아래 'formatted_summary' 텍스트를 활용하여 사용자에게 친절하고 정리된 불릿 리스트 형태로 답변해주세요.",
      formatted_summary: formattedSummary,
      results,
    };
  },
});
