const ONLINE_CHALLENGE_SELECT = "id, challenger_id, opponent_id, challenger_username, opponent_username, game_type, status, game_state, challenger_result, opponent_result, version, created_at, updated_at, accepted_at, completed_at";
const ONLINE_GAME_META = {
  memory: { label: "Memory Match", icon: "🧠", description: "Take turns matching six word-definition pairs." },
  paragraph: { label: "Paragraph Duel", icon: "✍️", description: "Use the same five words, then reveal both stories." },
  whack: { label: "Whack-a-Word", icon: "🔨", description: "Use your own dictionary and score as many points as possible in 60 seconds." },
  bubble: { label: "Bubble Shot", icon: "🫧", description: "Use your own dictionary and score as many points as possible in 60 seconds." }
};

let onlineChallengesReady = false;
let onlineChallengesAvailable = false;
let onlineChallengeFeed = null;
let onlinePendingCount = 0;
let activeOnlineChallenge = null;
let onlineMemoryResolveTimer = null;
let onlineArcadeTimer = null;
let onlineArcadeFrame = null;
let onlineMoleTimeouts = [];
let onlineArcadeGame = null;
let onlineParagraphDrafts = new Map();
let onlineLastUserId = null;

function onlineWordData(item) {
  return { word: item.word, definition: item.definition, partOfSpeech: item.partOfSpeech || "" };
}

function onlineGameMeta(type) {
  return ONLINE_GAME_META[type] || { label: "Vocabulary Game", icon: "🎮", description: "Online challenge" };
}

function onlineOpponentName(challenge) {
  return challenge.challenger_id === currentUser?.id ? challenge.opponent_username : challenge.challenger_username;
}

function onlinePlayerName(challenge, userId) {
  return userId === challenge.challenger_id ? challenge.challenger_username : challenge.opponent_username;
}

function onlineOwnResult(challenge) {
  return challenge.challenger_id === currentUser?.id ? challenge.challenger_result : challenge.opponent_result;
}

function onlineOpponentResult(challenge) {
  return challenge.challenger_id === currentUser?.id ? challenge.opponent_result : challenge.challenger_result;
}

function cloneOnlineState(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

function stopOnlineMemoryTimer() {
  if (onlineMemoryResolveTimer) clearTimeout(onlineMemoryResolveTimer);
  onlineMemoryResolveTimer = null;
}

function stopOnlineArcadeVisuals() {
  if (onlineArcadeTimer) clearInterval(onlineArcadeTimer);
  onlineArcadeTimer = null;
  if (onlineArcadeFrame) cancelAnimationFrame(onlineArcadeFrame);
  onlineArcadeFrame = null;
  onlineMoleTimeouts.forEach(clearTimeout);
  onlineMoleTimeouts = [];
}

function resetOnlineChallengeSession(clearActive = true) {
  stopOnlineMemoryTimer();
  stopOnlineArcadeVisuals();
  onlineArcadeGame = null;
  if (clearActive) activeOnlineChallenge = null;
}

async function initializeOnlineChallengeSystem(user = currentUser) {
  const userId = user?.id || null;
  if (userId === onlineLastUserId && onlineChallengesReady) return;
  onlineLastUserId = userId;
  onlineChallengesReady = false;
  onlineChallengesAvailable = false;
  onlinePendingCount = 0;
  resetOnlineChallengeSession();
  if (onlineChallengeFeed) {
    await supabaseClient.removeChannel(onlineChallengeFeed);
    onlineChallengeFeed = null;
  }
  if (!userId) return;

  const { error } = await supabaseClient
    .from("online_challenges")
    .select("id")
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .limit(1);
  if (currentUser?.id !== userId) return;
  onlineChallengesReady = true;
  onlineChallengesAvailable = !error;
  if (error) {
    syncHomeChallengeBadge();
    if (view === "challenges") render();
    return;
  }

  const onChallengeChange = (payload) => {
    const changed = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
    if (changed?.id && payload.eventType !== "DELETE") awardOnlineChallengeBonus(changed);
    if (changed?.id && activeOnlineChallenge?.id === changed.id && payload.eventType !== "DELETE") {
      activeOnlineChallenge = changed;
      awardOnlineMemoryStars(changed);
      if (view === "onlineGame") render();
    }
    refreshOnlinePendingCount();
    if (view === "challenges") render();
  };

  onlineChallengeFeed = supabaseClient
    .channel(`online-challenges-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_challenges", filter: `challenger_id=eq.${userId}` }, onChallengeChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_challenges", filter: `opponent_id=eq.${userId}` }, onChallengeChange)
    .subscribe();
  await refreshOnlinePendingCount();
  if (view === "challenges") render();
}

async function refreshOnlinePendingCount() {
  if (!currentUser || !onlineChallengesAvailable) {
    onlinePendingCount = 0;
    syncHomeChallengeBadge();
    return;
  }
  const { count, error } = await supabaseClient
    .from("online_challenges")
    .select("id", { count: "exact", head: true })
    .eq("opponent_id", currentUser.id)
    .eq("status", "pending");
  if (!error) onlinePendingCount = count || 0;
  syncHomeChallengeBadge();
}

function syncHomeChallengeBadge() {
  const badge = document.getElementById("homeChallengeBadge");
  if (!badge) return;
  badge.hidden = onlinePendingCount < 1;
  badge.textContent = onlinePendingCount > 9 ? "9+" : String(onlinePendingCount);
  badge.setAttribute("aria-label", `${onlinePendingCount} pending challenge${onlinePendingCount === 1 ? "" : "s"}`);
}

function buildOnlineGameState(type, challengerId, opponentId) {
  const source = getAllWords();
  if (source.length < (type === "whack" ? 6 : type === "bubble" ? 4 : type === "paragraph" ? 5 : 6)) return null;
  const sharedWordCount = type === "memory" ? 6 : type === "paragraph" ? 5 : 0;
  const words = sharedWordCount ? randomSample(source, sharedWordCount).map(onlineWordData) : [];
  const base = { createdAt: new Date().toISOString() };
  if (type === "memory") {
    base.words = words;
    const cards = words.flatMap((item, pairIndex) => [
      { pairIndex, kind: "term", content: item.word, partOfSpeech: item.partOfSpeech },
      { pairIndex, kind: "definition", content: item.definition, partOfSpeech: item.partOfSpeech }
    ]);
    base.memory = {
      cards: randomSample(cards, cards.length),
      flipped: [], matched: [], locked: false, resolver: null, resolveAt: null,
      currentPlayer: challengerId,
      scores: { [challengerId]: 0, [opponentId]: 0 },
      pairWinners: {}, winner: null,
      message: "The challenger goes first."
    };
  } else if (type === "paragraph") {
    base.words = words;
    base.paragraphs = {};
  } else {
    base.durationSeconds = 60;
    base.wordSource = "each-player-dictionary";
  }
  return base;
}

function openOnlineChallengeDialog(opponentId, opponentUsername) {
  if (!currentUser || opponentId === currentUser.id) return;
  document.querySelector(".online-challenge-modal")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "batch-modal-backdrop online-challenge-modal";
  backdrop.innerHTML = `<div class="batch-modal" role="dialog" aria-modal="true" aria-labelledby="onlineChallengeTitle">
    <h3 id="onlineChallengeTitle">Challenge ${escapeHtml(opponentUsername)}</h3>
    <p>Choose a game. They can accept or decline from their Online Challenges page.</p>
    <div class="challenge-modal-grid">
      ${Object.entries(ONLINE_GAME_META).map(([type, meta]) => `<button class="challenge-game-option" type="button" data-online-game-type="${type}"><span class="challenge-icon">${meta.icon}</span><strong>${meta.label}</strong><span>${meta.description}</span></button>`).join("")}
    </div>
    <p class="user-search-status" id="onlineChallengeModalStatus" role="status"></p>
    <div class="batch-modal-actions"><button class="small-btn" id="cancelOnlineChallenge">Cancel</button></div>
  </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector("#cancelOnlineChallenge").addEventListener("click", close);
  backdrop.querySelectorAll("[data-online-game-type]").forEach((button) => button.addEventListener("click", async () => {
    const status = backdrop.querySelector("#onlineChallengeModalStatus");
    backdrop.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    status.textContent = "Sending challenge…";
    const result = await createOnlineChallenge(opponentId, opponentUsername, button.dataset.onlineGameType);
    if (!result.ok) {
      status.textContent = result.message;
      backdrop.querySelectorAll("button").forEach((item) => { item.disabled = false; });
      return;
    }
    playGotItSound();
    close();
    view = "challenges";
    render();
  }));
}

async function createOnlineChallenge(opponentId, opponentUsername, type) {
  if (!onlineChallengesAvailable) return { ok: false, message: "Online challenges need the Supabase setup file first." };
  if (!publicProfile?.username) return { ok: false, message: "Choose a username in Settings before sending a challenge." };
  const gameState = buildOnlineGameState(type, currentUser.id, opponentId);
  if (!gameState) return { ok: false, message: "There are not enough dictionary words for this game." };
  const { error } = await supabaseClient.from("online_challenges").insert({
    challenger_id: currentUser.id,
    opponent_id: opponentId,
    challenger_username: publicProfile.username,
    opponent_username: opponentUsername,
    game_type: type,
    status: "pending",
    game_state: gameState
  });
  if (error) return { ok: false, message: error.message || "The challenge could not be sent." };
  return { ok: true };
}

async function fetchOnlineChallenge(id) {
  const { data, error } = await supabaseClient.from("online_challenges").select(ONLINE_CHALLENGE_SELECT).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function openOnlineChallenge(id) {
  const challenge = await fetchOnlineChallenge(id);
  if (!challenge) return;
  resetOnlineChallengeSession();
  activeOnlineChallenge = challenge;
  awardOnlineMemoryStars(challenge);
  awardOnlineChallengeBonus(challenge);
  view = "onlineGame";
  render();
}

async function updateOnlineChallenge(id, patch) {
  const { data, error } = await supabaseClient
    .from("online_challenges")
    .update(patch)
    .eq("id", id)
    .select(ONLINE_CHALLENGE_SELECT)
    .maybeSingle();
  if (!error && data) activeOnlineChallenge = data;
  return { data, error };
}

async function commitOnlineGameState(nextState, challenge = activeOnlineChallenge) {
  if (!challenge || challenge.status !== "active") return null;
  const { data, error } = await supabaseClient.rpc("update_online_challenge_state", {
    p_challenge_id: challenge.id,
    p_expected_version: challenge.version,
    p_game_state: nextState
  });
  const updated = Array.isArray(data) ? data[0] : data;
  if (!error && updated) {
    activeOnlineChallenge = updated;
    return updated;
  }
  const latest = await fetchOnlineChallenge(challenge.id);
  if (latest) activeOnlineChallenge = latest;
  return null;
}

function onlineChallengeCardHtml(challenge, kind) {
  const meta = onlineGameMeta(challenge.game_type);
  const incoming = challenge.opponent_id === currentUser.id;
  const otherName = onlineOpponentName(challenge);
  const statusLabel = challenge.status === "pending" ? (incoming ? "Your turn" : "Sent") : challenge.status;
  let actions = "";
  if (challenge.status === "pending" && incoming) {
    actions = `<button class="accent-btn" data-online-action="accept" data-challenge-id="${challenge.id}">Accept</button><button class="small-btn" data-online-action="decline" data-challenge-id="${challenge.id}">Decline</button>`;
  } else if (challenge.status === "pending") {
    actions = `<button class="small-btn" data-online-action="cancel" data-challenge-id="${challenge.id}">Cancel challenge</button>`;
  } else if (challenge.status === "active") {
    actions = `<button class="accent-btn" data-online-action="open" data-challenge-id="${challenge.id}">Play / Resume</button>`;
  } else if (challenge.status === "completed") {
    actions = `<button class="small-btn" data-online-action="open" data-challenge-id="${challenge.id}">View result</button>`;
  }
  return `<article class="online-challenge-card ${kind === "incoming" ? "incoming" : ""}">
    <div class="online-challenge-card-top"><span class="online-challenge-card-icon">${meta.icon}</span><div class="online-challenge-card-copy"><strong>${meta.label}</strong><span>${incoming ? "From" : "With"} ${escapeHtml(otherName)}</span></div><span class="online-challenge-status ${challenge.status}">${escapeHtml(statusLabel)}</span></div>
    <div class="online-challenge-actions">${actions}</div>
  </article>`;
}

async function loadOnlineChallenges() {
  if (!currentUser || !onlineChallengesAvailable) return [];
  const { data, error } = await supabaseClient
    .from("online_challenges")
    .select(ONLINE_CHALLENGE_SELECT)
    .or(`challenger_id.eq.${currentUser.id},opponent_id.eq.${currentUser.id}`)
    .order("updated_at", { ascending: false })
    .limit(50);
  return error ? [] : (data || []);
}

function renderOnlineChallenges(root) {
  root.innerHTML = `<section class="online-challenge-view" aria-labelledby="onlineChallengesTitle">
    <div class="online-challenge-heading"><div><h2 id="onlineChallengesTitle">Online Challenges</h2><p>Challenge a username, take your turn, and see live results from either account.</p></div><div class="online-challenge-heading-actions"><button class="small-btn" id="findChallengeOpponent">Find an opponent</button><button class="small-btn" id="refreshChallenges">Refresh</button></div></div>
    <div id="onlineChallengeContent"><div class="online-empty">Checking for challenges…</div></div>
  </section>`;
  root.querySelector("#findChallengeOpponent").addEventListener("click", () => { playClickSound(); view = "users"; render(); });
  root.querySelector("#refreshChallenges").addEventListener("click", () => renderOnlineChallenges(root));
  const content = root.querySelector("#onlineChallengeContent");

  const populate = async () => {
    if (!onlineChallengesReady) await initializeOnlineChallengeSystem(currentUser);
    if (!content.isConnected) return;
    if (!onlineChallengesAvailable) {
      content.innerHTML = `<div class="online-challenge-setup"><strong>One Supabase step is required.</strong><br>Open the Supabase SQL Editor, run <code>supabase-online-challenges.sql</code> once, then reload this page. The policies make every challenge visible only to its two players.</div>`;
      return;
    }
    const rows = await loadOnlineChallenges();
    if (!content.isConnected) return;
    const incoming = rows.filter((item) => item.status === "pending" && item.opponent_id === currentUser.id);
    const active = rows.filter((item) => item.status === "active");
    const outgoing = rows.filter((item) => item.status === "pending" && item.challenger_id === currentUser.id);
    const history = rows.filter((item) => ["completed", "declined", "cancelled"].includes(item.status)).slice(0, 12);
    const group = (title, items, kind) => `<section class="online-challenge-group"><h3>${title} (${items.length})</h3>${items.length ? `<div class="online-challenge-list">${items.map((item) => onlineChallengeCardHtml(item, kind)).join("")}</div>` : `<div class="online-empty">Nothing here yet.</div>`}</section>`;
    content.innerHTML = `<div class="online-challenge-groups">${group("Incoming", incoming, "incoming")}${group("In progress", active, "active")}${group("Sent", outgoing, "outgoing")}${group("Recent results", history, "history")}</div>`;
    content.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-online-action]");
      if (!button) return;
      button.disabled = true;
      const id = button.dataset.challengeId;
      const action = button.dataset.onlineAction;
      if (action === "open") return openOnlineChallenge(id);
      if (action === "accept") {
        const { data } = await updateOnlineChallenge(id, { status: "active", accepted_at: new Date().toISOString() });
        if (data) return openOnlineChallenge(id);
      } else if (action === "decline") {
        await updateOnlineChallenge(id, { status: "declined" });
      } else if (action === "cancel") {
        await updateOnlineChallenge(id, { status: "cancelled" });
      }
      render();
    });
  };
  populate();
}

function onlineMatchBanner(challenge) {
  const meta = onlineGameMeta(challenge.game_type);
  return `<div class="online-match-banner"><div><span>${meta.icon} ${meta.label}</span><strong> You vs ${escapeHtml(onlineOpponentName(challenge))}</strong></div><span class="online-live-pill">LIVE MATCH</span></div>`;
}

function renderOnlineGame(root) {
  const challenge = activeOnlineChallenge;
  if (!challenge) {
    root.innerHTML = `<div class="online-empty">Choose a challenge from the Online Challenges page.</div>`;
    return;
  }
  awardOnlineChallengeBonus(challenge);
  root.innerHTML = `<section class="online-game-shell">${onlineMatchBanner(challenge)}<div id="onlineGameBody"></div></section>`;
  const body = root.querySelector("#onlineGameBody");
  if (challenge.status === "pending") {
    body.innerHTML = `<div class="online-waiting"><div class="online-waiting-icon">⏳</div><h2>Waiting for ${escapeHtml(challenge.opponent_username)}</h2><p>The game will unlock as soon as the challenge is accepted.</p></div>`;
    return;
  }
  if (["declined", "cancelled"].includes(challenge.status)) {
    body.innerHTML = `<div class="online-result"><h2>Challenge ${challenge.status}</h2><p>This match is no longer active.</p></div>`;
    return;
  }
  if (challenge.game_type === "memory") renderOnlineMemory(body, challenge);
  else if (challenge.game_type === "paragraph") renderOnlineParagraph(body, challenge);
  else renderOnlineArcade(body, challenge);
}

function awardOnlineMemoryStars(challenge) {
  if (!challenge || challenge.game_type !== "memory" || !currentUser) return;
  const winners = challenge.game_state?.memory?.pairWinners || {};
  let newStars = 0;
  Object.entries(winners).forEach(([pairIndex, userId]) => {
    if (userId === currentUser.id) newStars += awardStars(1, `online-memory:${challenge.id}:pair:${pairIndex}`, "Online Memory Match", false);
  });
  if (newStars) queueStarNotification(newStars, "Online Memory Match");
}

function onlineChallengeWinner(challenge) {
  if (!challenge || challenge.game_type === "paragraph") return null;
  if (challenge.game_type === "memory") {
    const winner = challenge.game_state?.memory?.winner;
    return winner && winner !== "tie" ? winner : null;
  }
  if (!challenge.challenger_result || !challenge.opponent_result) return null;
  const challengerScore = Number(challenge.challenger_result.score || 0);
  const opponentScore = Number(challenge.opponent_result.score || 0);
  if (challengerScore === opponentScore) return null;
  return challengerScore > opponentScore ? challenge.challenger_id : challenge.opponent_id;
}

function awardOnlineChallengeBonus(challenge) {
  if (!challenge || !currentUser) return 0;
  let awarded = 0;
  let label = "Online Challenge";
  if (challenge.game_type === "paragraph") {
    if (challenge.game_state?.paragraphs?.[currentUser.id]) {
      awarded = awardStars(1, `online-participation:${challenge.id}:${currentUser.id}`, "Paragraph Duel participation", false);
      label = "Paragraph Duel participation";
    }
  } else if (onlineChallengeWinner(challenge) === currentUser.id) {
    awarded = awardStars(5, `online-winner:${challenge.id}:${currentUser.id}`, "Online challenge victory", false);
    label = "Online challenge victory";
  }
  if (awarded) queueStarNotification(awarded, label);
  return awarded;
}

function onlineMemoryWinnerText(challenge, memory) {
  if (memory.winner === "tie") return "It's a tie!";
  if (!memory.winner) return "";
  return memory.winner === currentUser.id ? "You win!" : `${onlinePlayerName(challenge, memory.winner)} wins!`;
}

function renderOnlineMemory(root, challenge) {
  const memory = challenge.game_state?.memory;
  if (!memory) {
    root.innerHTML = `<div class="online-empty">This Memory Match could not be loaded.</div>`;
    return;
  }
  awardOnlineMemoryStars(challenge);
  const matched = new Set(memory.matched || []);
  const flipped = memory.flipped || [];
  const myTurn = memory.currentPlayer === currentUser.id;
  const finished = challenge.status === "completed" || matched.size === memory.cards.length;
  const scoreOne = Number(memory.scores?.[challenge.challenger_id] || 0);
  const scoreTwo = Number(memory.scores?.[challenge.opponent_id] || 0);
  const turnLabel = finished ? "GAME OVER" : myTurn ? "YOUR TURN" : `${onlinePlayerName(challenge, memory.currentPlayer).toUpperCase()}'S TURN`;
  root.innerHTML = `<section class="memory-game online-memory-game" aria-labelledby="onlineMemoryTitle">
    <div class="game-heading"><div><h2 id="onlineMemoryTitle">Online Memory Match</h2><p>Matches keep the turn; misses pass it to your opponent.</p></div></div>
    <div class="memory-scoreboard"><div class="memory-player ${memory.currentPlayer === challenge.challenger_id && !finished ? "active" : ""}">${escapeHtml(challenge.challenger_username)}<strong>${scoreOne}</strong></div><div class="memory-turn">${turnLabel}</div><div class="memory-player ${memory.currentPlayer === challenge.opponent_id && !finished ? "active" : ""}">${escapeHtml(challenge.opponent_username)}<strong>${scoreTwo}</strong></div></div>
    ${finished ? `<div class="memory-ending"><h3>${escapeHtml(onlineMemoryWinnerText(challenge, memory))}</h3><p>Final score: ${scoreOne}–${scoreTwo}</p><p>${memory.winner === "tie" ? "A tied match has no winner bonus." : "The winner earns 5 bonus Stars."}</p></div>` : `<div class="memory-message ${memory.locked ? "syncing" : ""}" aria-live="polite">${escapeHtml(memory.message || (myTurn ? "Choose two cards." : "Waiting for your opponent…"))}</div><div class="memory-grid">${memory.cards.map((card, index) => {
      const revealed = flipped.includes(index) || matched.has(index);
      return `<button class="memory-card ${card.kind} ${revealed ? "revealed" : ""} ${matched.has(index) ? "matched" : ""}" data-online-memory-index="${index}" ${matched.has(index) || memory.locked || !myTurn ? "disabled" : ""}>${revealed ? `<span class="memory-card-kind">${card.kind}</span>${escapeHtml(card.content)}${card.kind === "term" ? `<span class="part-of-speech card-part-of-speech">${escapeHtml(card.partOfSpeech || "Not specified")}</span>` : ""}` : `<span class="memory-card-back">?</span>`}</button>`;
    }).join("")}</div>`}
  </section>`;
  root.querySelectorAll("[data-online-memory-index]").forEach((button) => button.addEventListener("click", () => flipOnlineMemoryCard(Number(button.dataset.onlineMemoryIndex))));
  maybeScheduleOnlineMemoryResolution(challenge);
}

async function flipOnlineMemoryCard(index) {
  const challenge = activeOnlineChallenge;
  const state = cloneOnlineState(challenge?.game_state);
  const memory = state.memory;
  if (!challenge || challenge.status !== "active" || !memory || memory.currentPlayer !== currentUser.id || memory.locked) return;
  if ((memory.flipped || []).includes(index) || (memory.matched || []).includes(index)) return;
  playFlipSound();
  memory.flipped = [...(memory.flipped || []), index];
  if (memory.flipped.length === 1) {
    memory.message = `${publicProfile?.username || "You"}, choose one more card.`;
  } else {
    memory.locked = true;
    memory.resolver = currentUser.id;
    memory.resolveAt = Date.now() + 900;
    memory.message = "Checking the pair…";
  }
  await commitOnlineGameState(state, challenge);
  if (view === "onlineGame") render();
}

function maybeScheduleOnlineMemoryResolution(challenge) {
  stopOnlineMemoryTimer();
  const memory = challenge.game_state?.memory;
  if (!memory?.locked || (memory.flipped || []).length !== 2 || challenge.status !== "active") return;
  const wait = Math.max(0, Number(memory.resolveAt || Date.now()) - Date.now());
  onlineMemoryResolveTimer = setTimeout(resolveOnlineMemoryTurn, wait + 25);
}

async function resolveOnlineMemoryTurn() {
  stopOnlineMemoryTimer();
  const current = activeOnlineChallenge && await fetchOnlineChallenge(activeOnlineChallenge.id);
  const memory = current?.game_state?.memory;
  if (!current || current.status !== "active" || !memory?.locked || (memory.flipped || []).length !== 2) return;
  const [firstIndex, secondIndex] = memory.flipped;
  const first = memory.cards[firstIndex];
  const second = memory.cards[secondIndex];
  const actingPlayer = memory.resolver || memory.currentPlayer;
  const matchedPair = first && second && first.pairIndex === second.pairIndex && first.kind !== second.kind;
  const state = cloneOnlineState(current.game_state);
  const next = state.memory;
  if (matchedPair) {
    next.matched = [...new Set([...(next.matched || []), firstIndex, secondIndex])];
    next.scores[actingPlayer] = Number(next.scores[actingPlayer] || 0) + 1;
    next.pairWinners[String(first.pairIndex)] = actingPlayer;
    next.message = `${onlinePlayerName(current, actingPlayer)} found a match and plays again!`;
  } else {
    next.currentPlayer = actingPlayer === current.challenger_id ? current.opponent_id : current.challenger_id;
    next.message = `No match. ${onlinePlayerName(current, next.currentPlayer)} goes next.`;
  }
  next.flipped = [];
  next.locked = false;
  next.resolver = null;
  next.resolveAt = null;
  if (next.matched.length === next.cards.length) {
    const firstScore = Number(next.scores[current.challenger_id] || 0);
    const secondScore = Number(next.scores[current.opponent_id] || 0);
    next.winner = firstScore === secondScore ? "tie" : firstScore > secondScore ? current.challenger_id : current.opponent_id;
  }
  const updated = await commitOnlineGameState(state, current);
  if (updated?.game_state?.memory?.winner) {
    await updateOnlineChallenge(updated.id, { status: "completed", completed_at: new Date().toISOString() });
  }
  awardOnlineMemoryStars(activeOnlineChallenge);
  awardOnlineChallengeBonus(activeOnlineChallenge);
  if (view === "onlineGame") render();
}

function onlineParagraphUsedWords(text, words) {
  return words.filter((item) => paragraphUsesWord(text, item.word));
}

function renderOnlineParagraph(root, challenge) {
  const words = challenge.game_state?.words || [];
  const paragraphs = challenge.game_state?.paragraphs || {};
  const ownSubmission = paragraphs[currentUser.id];
  const opponentId = challenge.challenger_id === currentUser.id ? challenge.opponent_id : challenge.challenger_id;
  const opponentSubmission = paragraphs[opponentId];
  const bothDone = Boolean(ownSubmission && opponentSubmission);
  if (bothDone || challenge.status === "completed") {
    root.innerHTML = `<section class="paragraph-challenge"><div class="paragraph-heading"><div><h2>Paragraph Duel Complete</h2><p>Both stories use the same five vocabulary words. Each participant earns 1 additional Star.</p></div></div><div class="paragraph-word-list">${words.map((item) => `<span class="paragraph-word-chip used">${escapeHtml(item.word)}</span>`).join("")}</div><div class="online-paragraph-columns"><article class="online-paragraph-entry"><h3>${escapeHtml(challenge.challenger_username)}</h3><p>${escapeHtml(paragraphs[challenge.challenger_id]?.text || "No paragraph submitted.")}</p></article><article class="online-paragraph-entry"><h3>${escapeHtml(challenge.opponent_username)}</h3><p>${escapeHtml(paragraphs[challenge.opponent_id]?.text || "No paragraph submitted.")}</p></article></div></section>`;
    return;
  }
  if (ownSubmission) {
    root.innerHTML = `<div class="online-waiting"><div class="online-waiting-icon">✍️</div><h2>Your paragraph is submitted</h2><p>You earned 1 additional participation Star. ${opponentSubmission ? "Opening both stories…" : `Waiting for ${escapeHtml(onlineOpponentName(challenge))} to finish writing.`}</p></div>`;
    return;
  }
  const draft = onlineParagraphDrafts.get(challenge.id) || "";
  const used = onlineParagraphUsedWords(draft, words);
  root.innerHTML = `<section class="paragraph-challenge"><div class="paragraph-heading"><div><h2>Paragraph Duel</h2><p>Use all five words. Both paragraphs are revealed after both players submit.</p></div></div><div class="paragraph-word-panel"><h3>Words to include <span class="part-of-speech">Select a word for its definition</span></h3><div class="paragraph-word-list">${words.map((item, index) => `<button class="paragraph-word-chip ${used.includes(item) ? "used" : ""}" data-online-paragraph-word="${index}">${escapeHtml(item.word)}</button>`).join("")}</div><div class="paragraph-definition" id="onlineParagraphDefinition" hidden></div></div><div class="paragraph-editor"><label for="onlineParagraphText">Your paragraph</label><textarea id="onlineParagraphText" placeholder="Start writing here…" spellcheck="true">${escapeHtml(draft)}</textarea><div class="paragraph-progress"><span>Each vocabulary word must appear as a complete word.</span><strong id="onlineParagraphCount">${used.length} / ${words.length} used</strong></div></div><div class="paragraph-success" id="onlineParagraphSuccess" ${used.length === words.length ? "" : "hidden"}>Ready to submit!</div><div class="paragraph-actions"><button class="accent-btn" id="submitOnlineParagraph" ${used.length === words.length ? "" : "disabled"}>Submit paragraph</button></div></section>`;
  const textarea = root.querySelector("#onlineParagraphText");
  const update = () => {
    onlineParagraphDrafts.set(challenge.id, textarea.value);
    const nowUsed = onlineParagraphUsedWords(textarea.value, words);
    words.forEach((item, index) => root.querySelector(`[data-online-paragraph-word="${index}"]`)?.classList.toggle("used", nowUsed.includes(item)));
    root.querySelector("#onlineParagraphCount").textContent = `${nowUsed.length} / ${words.length} used`;
    root.querySelector("#onlineParagraphSuccess").hidden = nowUsed.length !== words.length;
    root.querySelector("#submitOnlineParagraph").disabled = nowUsed.length !== words.length;
  };
  textarea.addEventListener("input", update);
  root.querySelectorAll("[data-online-paragraph-word]").forEach((button) => button.addEventListener("click", () => {
    const item = words[Number(button.dataset.onlineParagraphWord)];
    const definition = root.querySelector("#onlineParagraphDefinition");
    definition.innerHTML = `<strong>${escapeHtml(item.word)}${item.partOfSpeech ? ` <span class="part-of-speech">${escapeHtml(item.partOfSpeech)}</span>` : ""}</strong>${escapeHtml(item.definition)}`;
    definition.hidden = false;
  }));
  root.querySelector("#submitOnlineParagraph").addEventListener("click", submitOnlineParagraph);
}

async function submitOnlineParagraph() {
  const challenge = activeOnlineChallenge;
  const text = onlineParagraphDrafts.get(challenge.id) || "";
  const words = challenge.game_state?.words || [];
  if (onlineParagraphUsedWords(text, words).length !== words.length) return;
  const state = cloneOnlineState(challenge.game_state);
  state.paragraphs = state.paragraphs || {};
  state.paragraphs[currentUser.id] = { text: text.trim(), submittedAt: new Date().toISOString() };
  const updated = await commitOnlineGameState(state, challenge);
  if (!updated) return render();
  words.forEach((item) => awardStars(1, `online-paragraph:${challenge.id}:word:${item.word.toLowerCase()}`, "Online Paragraph Duel", false));
  queueStarNotification(words.length, "Online Paragraph Duel");
  awardOnlineChallengeBonus(updated);
  const submissions = updated.game_state?.paragraphs || {};
  if (submissions[updated.challenger_id] && submissions[updated.opponent_id]) {
    await updateOnlineChallenge(updated.id, { status: "completed", completed_at: new Date().toISOString() });
  }
  if (view === "onlineGame") render();
}

function ensureOnlineArcadeGame(challenge) {
  if (onlineArcadeGame?.challengeId === challenge.id) return true;
  stopOnlineArcadeVisuals();
  const localWords = getAllWords().map(onlineWordData);
  const requiredWords = challenge.game_type === "whack" ? 6 : 4;
  if (localWords.length < requiredWords) {
    onlineArcadeGame = null;
    return false;
  }
  onlineArcadeGame = {
    challengeId: challenge.id, type: challenge.game_type,
    words: localWords,
    score: 0, correct: 0, incorrect: 0, streak: 0,
    deadline: performance.now() + Number(challenge.game_state?.durationSeconds || 60) * 1000,
    roundStartedAt: performance.now(), answerShownAt: 0,
    answer: null, choices: [], locked: false, feedback: "", feedbackType: "", submitted: false
  };
  createOnlineArcadeRound(challenge);
  return true;
}

function createOnlineArcadeRound(challenge = activeOnlineChallenge) {
  const game = onlineArcadeGame;
  const words = game?.words || [];
  const choiceCount = game.type === "whack" ? 6 : 4;
  if (words.length < choiceCount) return;
  const answer = words[Math.floor(Math.random() * words.length)];
  const decoys = randomSample(words.filter((item) => item.word.toLowerCase() !== answer.word.toLowerCase()), choiceCount - 1);
  game.answer = answer;
  game.choices = randomSample([answer, ...decoys], choiceCount);
  game.roundStartedAt = performance.now();
  game.answerShownAt = 0;
  game.locked = false;
  game.feedback = "";
  game.feedbackType = "";
}

function onlineArcadeRemaining() {
  return onlineArcadeGame ? Math.max(0, (onlineArcadeGame.deadline - performance.now()) / 1000) : 0;
}

function startOnlineArcadeClock(root) {
  if (onlineArcadeTimer) clearInterval(onlineArcadeTimer);
  const update = () => {
    if (view !== "onlineGame" || !onlineArcadeGame || onlineArcadeGame.submitted) return stopOnlineArcadeVisuals();
    const remaining = onlineArcadeRemaining();
    const timer = root.querySelector("#onlineArcadeClock");
    if (timer) timer.textContent = `${remaining.toFixed(1)}s`;
    if (remaining <= 0) finishOnlineArcade();
  };
  update();
  onlineArcadeTimer = setInterval(update, 100);
}

function renderOnlineArcade(root, challenge) {
  const ownResult = onlineOwnResult(challenge);
  const opponentResult = onlineOpponentResult(challenge);
  if (ownResult) {
    renderOnlineArcadeResult(root, challenge, ownResult, opponentResult);
    return;
  }
  if (!ensureOnlineArcadeGame(challenge)) {
    const requiredWords = challenge.game_type === "whack" ? 6 : 4;
    root.innerHTML = `<div class="online-empty">You need at least ${requiredWords} words in your own Dictionary to play ${escapeHtml(onlineGameMeta(challenge.game_type).label)}.</div>`;
    return;
  }
  if (challenge.game_type === "bubble") renderOnlineBubble(root, challenge);
  else renderOnlineWhack(root, challenge);
}

function onlineArcadeStatsHtml(game) {
  return `<div class="game-stats"><div class="stat-pill"><strong id="onlineArcadeScore">${game.score}</strong><span>Score</span></div><div class="stat-pill"><strong>${game.streak}</strong><span>Streak</span></div><div class="stat-pill"><strong class="online-arcade-clock" id="onlineArcadeClock">${onlineArcadeRemaining().toFixed(1)}s</strong><span>Remaining</span></div></div>`;
}

function startOnlineBubblePhysics(field) {
  if (onlineArcadeFrame) cancelAnimationFrame(onlineArcadeFrame);
  const bubbles = [...field.querySelectorAll(".word-bubble")];
  const width = field.clientWidth;
  const height = field.clientHeight;
  const bodies = bubbles.map((element, index) => {
    const size = element.offsetWidth;
    const angle = Math.random() * Math.PI * 2;
    return { element, size, x: (index % 2 ? .65 : .1) * Math.max(0, width - size), y: (index > 1 ? .62 : .1) * Math.max(0, height - size), vx: Math.cos(angle) * (38 + Math.random() * 24), vy: Math.sin(angle) * (38 + Math.random() * 24) };
  });
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(.032, (now - last) / 1000); last = now;
    bodies.forEach((body) => {
      if (body.element.classList.contains("hit")) return;
      body.x += body.vx * dt; body.y += body.vy * dt;
      if (body.x <= 0 || body.x + body.size >= width) { body.vx *= -1; body.x = Math.max(0, Math.min(width - body.size, body.x)); }
      if (body.y <= 0 || body.y + body.size >= height) { body.vy *= -1; body.y = Math.max(0, Math.min(height - body.size, body.y)); }
      body.element.style.transform = `translate3d(${body.x}px, ${body.y}px, 0)`;
    });
    if (view === "onlineGame" && activeOnlineChallenge?.id === onlineArcadeGame?.challengeId && !onlineArcadeGame?.submitted) onlineArcadeFrame = requestAnimationFrame(step);
  };
  onlineArcadeFrame = requestAnimationFrame(step);
}

function renderOnlineBubble(root, challenge) {
  const game = onlineArcadeGame;
  root.innerHTML = `<section class="bubble-game"><div class="game-heading"><div><h2>Bubble Shot Duel</h2><p>Shoot the matching word. Your 60-second run cannot be paused.</p></div>${onlineArcadeStatsHtml(game)}</div><div class="definition-prompt"><div class="side-label">FIND THIS WORD</div><p>${escapeHtml(game.answer.definition)}</p></div><div class="bubble-field online-bubble-field">${game.choices.map((choice, index) => `<button class="word-bubble" data-online-bubble="${index}" ${game.locked ? "disabled" : ""}><span class="bubble-word">${escapeHtml(choice.word)}</span><span class="pop-spray">${"<i></i>".repeat(12)}</span></button>`).join("")}<div class="aim-hint">60-second duel</div></div><div class="game-feedback ${game.feedbackType}">${escapeHtml(game.feedback)}</div></section>`;
  startOnlineArcadeClock(root);
  startOnlineBubblePhysics(root.querySelector(".bubble-field"));
  root.querySelectorAll("[data-online-bubble]").forEach((button) => button.addEventListener("click", () => hitOnlineBubble(button, Number(button.dataset.onlineBubble))));
}

function hitOnlineBubble(button, index) {
  const game = onlineArcadeGame;
  if (!game || game.locked || onlineArcadeRemaining() <= 0) return;
  game.locked = true;
  const choice = game.choices[index];
  const correct = choice.word === game.answer.word;
  const elapsed = Math.max(0, (performance.now() - game.roundStartedAt) / 1000);
  if (correct) {
    game.correct++; game.streak++;
    const points = Math.max(100, Math.round(1000 - elapsed * 90)) + Math.min((game.streak - 1) * 25, 250);
    game.score += points; game.feedback = `Bullseye! +${points} points.`; game.feedbackType = "correct"; playGotItSound();
  } else {
    game.incorrect++; game.streak = 0;
    const lost = Math.min(250, game.score); game.score = Math.max(0, game.score - 250);
    game.feedback = lost ? `Wrong bubble: -${lost}. The answer is ${game.answer.word}.` : `Wrong bubble. The answer is ${game.answer.word}.`;
    game.feedbackType = "wrong"; playDontKnowSound();
  }
  button.classList.add(correct ? "correct" : "wrong", "hit");
  if (!correct) {
    const correctIndex = game.choices.findIndex((item) => item.word === game.answer.word);
    document.querySelector(`[data-online-bubble="${correctIndex}"]`)?.classList.add("answer-reveal");
  }
  document.getElementById("onlineArcadeScore").textContent = game.score;
  const feedback = document.querySelector(".online-game-shell .game-feedback");
  if (feedback) { feedback.className = `game-feedback ${game.feedbackType}`; feedback.textContent = game.feedback; }
  setTimeout(() => {
    if (view === "onlineGame" && onlineArcadeGame === game && !game.submitted && onlineArcadeRemaining() > 0) { createOnlineArcadeRound(); render(); }
  }, 650);
}

function scheduleOnlineMoles(root) {
  onlineMoleTimeouts.forEach(clearTimeout); onlineMoleTimeouts = [];
  const buttons = [...root.querySelectorAll(".mole")];
  const visible = new Set();
  const hide = (button, index) => {
    if (!button.isConnected || onlineArcadeGame?.locked || onlineArcadeRemaining() <= 0) return;
    button.classList.remove("up"); button.disabled = true; visible.delete(index);
    if (onlineArcadeGame.choices[index].word === onlineArcadeGame.answer.word) onlineArcadeGame.answerShownAt = 0;
    onlineMoleTimeouts.push(setTimeout(() => show(button, index), 1200 + Math.random() * 1000));
  };
  const show = (button, index) => {
    if (!button.isConnected || onlineArcadeGame?.locked || onlineArcadeRemaining() <= 0) return;
    if (visible.size >= 3) { onlineMoleTimeouts.push(setTimeout(() => show(button, index), 180)); return; }
    visible.add(index); button.classList.add("up"); button.disabled = false;
    if (onlineArcadeGame.choices[index].word === onlineArcadeGame.answer.word) onlineArcadeGame.answerShownAt = performance.now();
    onlineMoleTimeouts.push(setTimeout(() => hide(button, index), 1800 + Math.random() * 900));
  };
  buttons.forEach((button, index) => onlineMoleTimeouts.push(setTimeout(() => show(button, index), 400 + Math.random() * 1700)));
}

function renderOnlineWhack(root, challenge) {
  const game = onlineArcadeGame;
  root.innerHTML = `<section class="whack-game"><div class="game-heading"><div><h2>Whack-a-Word Duel</h2><p>Whack the matching mole. Your 60-second run cannot be paused.</p></div>${onlineArcadeStatsHtml(game)}</div><div class="definition-prompt"><div class="side-label">WHACK THIS WORD</div><p>${escapeHtml(game.answer.definition)}</p></div><div class="whack-yard online-whack-yard">${game.choices.map((choice, index) => `<div class="mole-hole"><button class="mole" data-online-mole="${index}" disabled><span class="mole-word">${escapeHtml(choice.word)}</span></button></div>`).join("")}<img class="whack-mallet" src="assets/whack-mallet.png" alt=""></div><div class="whack-feedback ${game.feedbackType}">${escapeHtml(game.feedback)}</div></section>`;
  const yard = root.querySelector(".whack-yard");
  const mallet = root.querySelector(".whack-mallet");
  yard.addEventListener("pointermove", (event) => { const rect = yard.getBoundingClientRect(); mallet.style.left = `${event.clientX - rect.left}px`; mallet.style.top = `${event.clientY - rect.top}px`; });
  yard.addEventListener("pointerenter", () => yard.classList.add("mallet-active"));
  yard.addEventListener("pointerleave", () => yard.classList.remove("mallet-active"));
  startOnlineArcadeClock(root);
  scheduleOnlineMoles(root);
  root.querySelectorAll("[data-online-mole]").forEach((button) => button.addEventListener("click", () => hitOnlineMole(button, Number(button.dataset.onlineMole))));
}

function hitOnlineMole(button, index) {
  const game = onlineArcadeGame;
  if (!game || game.locked || button.disabled || !button.classList.contains("up") || onlineArcadeRemaining() <= 0) return;
  game.locked = true;
  onlineMoleTimeouts.forEach(clearTimeout); onlineMoleTimeouts = [];
  const choice = game.choices[index];
  const correct = choice.word === game.answer.word;
  button.classList.add("bonked", "up");
  if (correct) {
    game.correct++; game.streak++;
    const response = game.answerShownAt ? (performance.now() - game.answerShownAt) / 1000 : 0;
    const scoringTime = Math.max(0, response - 2);
    const points = Math.max(100, Math.round(800 - scoringTime * 45)) + Math.min((game.streak - 1) * 25, 200);
    game.score += points; game.feedback = `Great whack! +${points} points.`; game.feedbackType = "correct"; button.classList.add("correct-mole"); playGotItSound();
  } else {
    game.incorrect++; game.streak = 0;
    const lost = Math.min(100, game.score); game.score = Math.max(0, game.score - 100);
    game.feedback = lost ? `Wrong mole: -${lost}. The answer is ${game.answer.word}.` : `Wrong mole. The answer is ${game.answer.word}.`;
    game.feedbackType = "wrong"; playDontKnowSound();
    const answerIndex = game.choices.findIndex((item) => item.word === game.answer.word);
    document.querySelector(`[data-online-mole="${answerIndex}"]`)?.classList.add("up", "correct-mole");
  }
  document.getElementById("onlineArcadeScore").textContent = game.score;
  const feedback = document.querySelector(".online-game-shell .whack-feedback");
  if (feedback) { feedback.className = `whack-feedback ${game.feedbackType}`; feedback.textContent = game.feedback; }
  setTimeout(() => {
    if (view === "onlineGame" && onlineArcadeGame === game && !game.submitted && onlineArcadeRemaining() > 0) { createOnlineArcadeRound(); render(); }
  }, 650);
}

async function finishOnlineArcade() {
  const game = onlineArcadeGame;
  const challenge = activeOnlineChallenge;
  if (!game || game.submitted || !challenge || onlineOwnResult(challenge)) return;
  game.submitted = true;
  stopOnlineArcadeVisuals();
  const result = { score: Math.max(0, Math.round(game.score)), correct: game.correct, incorrect: game.incorrect, finishedAt: new Date().toISOString() };
  const resultColumn = challenge.challenger_id === currentUser.id ? "challenger_result" : "opponent_result";
  const stars = Math.round(result.score / 1000);
  if (stars) awardStars(stars, `online-arcade:${challenge.id}:${currentUser.id}`, onlineGameMeta(challenge.game_type).label);
  const { data } = await updateOnlineChallenge(challenge.id, { [resultColumn]: result });
  if (data?.challenger_result && data?.opponent_result) {
    await updateOnlineChallenge(data.id, { status: "completed", completed_at: new Date().toISOString() });
  }
  awardOnlineChallengeBonus(activeOnlineChallenge);
  if (view === "onlineGame") render();
}

function renderOnlineArcadeResult(root, challenge, ownResult, opponentResult) {
  if (!opponentResult) {
    root.innerHTML = `<div class="online-waiting"><div class="online-waiting-icon">🏁</div><h2>Your run is complete</h2><p>You scored <strong>${Number(ownResult.score || 0).toLocaleString()}</strong>. Waiting for ${escapeHtml(onlineOpponentName(challenge))} to finish their 60-second run.</p></div>`;
    return;
  }
  const challengerScore = Number(challenge.challenger_result?.score || 0);
  const opponentScore = Number(challenge.opponent_result?.score || 0);
  const winner = challengerScore === opponentScore ? null : challengerScore > opponentScore ? challenge.challenger_id : challenge.opponent_id;
  const title = winner === null ? "It's a tie!" : winner === currentUser.id ? "You win!" : `${onlinePlayerName(challenge, winner)} wins!`;
  root.innerHTML = `<div class="online-result"><div class="online-waiting-icon">🏆</div><h2>${escapeHtml(title)}</h2><p>Both players completed their 60-second run. ${winner === null ? "A tied match has no winner bonus." : "The winner earns 5 bonus Stars on top of score-based Stars."}</p><div class="online-result-score"><div class="online-result-player">${escapeHtml(challenge.challenger_username)}<strong>${challengerScore.toLocaleString()}</strong></div><span>vs</span><div class="online-result-player">${escapeHtml(challenge.opponent_username)}<strong>${opponentScore.toLocaleString()}</strong></div></div></div>`;
}

function leaveOnlineGame() {
  if (activeOnlineChallenge?.status === "active" && ["bubble", "whack"].includes(activeOnlineChallenge.game_type) && onlineArcadeGame && !onlineArcadeGame.submitted && !onlineOwnResult(activeOnlineChallenge)) {
    finishOnlineArcade();
  }
  resetOnlineChallengeSession();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => initializeOnlineChallengeSystem(session?.user || null), 0);
});
supabaseClient.auth.getSession().then(({ data }) => initializeOnlineChallengeSystem(data.session?.user || null));
