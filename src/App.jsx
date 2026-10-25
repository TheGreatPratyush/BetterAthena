import { useEffect, useRef, useState } from "react";
import "./App.css";

// =============================================================================
// Exam content
// Edit QUESTIONS and ANSWER_KEY here to change what appears in the exam.
// =============================================================================

const QUESTIONS = [
  {
    text: "Which planet is known as the Red Planet?",
    options: ["Venus", "Mars", "Jupiter", "Saturn"],
  },
  {
    text: "What is the largest ocean on Earth?",
    options: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"],
  },
  {
    text: "How many continents are there on Earth?",
    options: ["5", "6", "7", "8"],
  },
  {
    text: "What is the chemical symbol for water?",
    options: ["O2", "H2O", "CO2", "NaCl"],
  },
  {
    text: "In which country was the World Wide Web invented?",
    options: ["United States", "Germany", "United Kingdom", "Japan"],
  },
];

// The index of the correct option for each question (0-based).
// ANSWER_KEY[i] is the correct index into QUESTIONS[i].options.
// e.g. ANSWER_KEY[0] = 1 means "Mars" is correct for question 0.
const ANSWER_KEY = [1, 3, 2, 1, 2];

// How long the exam lasts, in seconds. 10 minutes = 600 seconds.
const EXAM_DURATION = 10 * 60;

// =============================================================================
// Helper: format a number of seconds as MM:SS  (e.g. 125 → "02:05")
// =============================================================================

function formatTime(totalSeconds) {
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const ss = (totalSeconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

// =============================================================================
// App component
// =============================================================================

function App() {
  // Controls which screen is shown. Starts on "setup", moves to "exam", then "results".
  const [screen, setScreen] = useState("setup");

  // ── Camera ──────────────────────────────────────────────────────────────────
  const videoRef = useRef(null);         // <video> element that holds the camera stream
  const imageCaptureRef = useRef(null);  // ImageCapture object used to take snapshots
  const [cameraGranted, setCameraGranted] = useState(false);
  const [cameraError, setCameraError]     = useState("");

  // ── Exam ─────────────────────────────────────────────────────────────────────
  const [currentQ, setCurrentQ]           = useState(0);   // index of the visible question
  const [answers, setAnswers]             = useState({});   // { questionIndex: optionIndex }
  const [timeLeft, setTimeLeft]           = useState(EXAM_DURATION);
  const [submitted, setSubmitted]         = useState(false);
  const [monitoringEvents, setMonitoringEvents] = useState([]); // tab-switch timestamps

  // ── Results ──────────────────────────────────────────────────────────────────
  const [results, setResults]   = useState(null);
  const [saveError, setSaveError] = useState("");

  // ── Refs ──────────────────────────────────────────────────────────────────────
  // React state updates are asynchronous, so callbacks that run on a timer or in
  // an event listener may read stale state values from their closure. We mirror
  // the three values that matter into refs so they are always current.
  const submittedRef     = useRef(false);
  const answersRef       = useRef({});
  const monitoringRef    = useRef([]);

  useEffect(() => { submittedRef.current  = submitted;       }, [submitted]);
  useEffect(() => { answersRef.current    = answers;          }, [answers]);
  useEffect(() => { monitoringRef.current = monitoringEvents; }, [monitoringEvents]);

  // =============================================================================
  // Camera helpers
  // =============================================================================

  async function requestCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      imageCaptureRef.current = new ImageCapture(track);
      setCameraGranted(true);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setCameraError(
          "Camera permission was denied. Please allow camera access in your system settings and try again."
        );
      } else if (err.name === "NotFoundError") {
        setCameraError("No camera was found on this device.");
      } else {
        setCameraError("Could not start camera: " + err.message);
      }
    }
  }

  // Stop all camera tracks to release the device.
  function stopCamera() {
    const stream = videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  }

  // =============================================================================
  // Start exam (called when student clicks "Start Exam")
  // =============================================================================

  async function handleStartExam() {
    // Show the rules dialog via Electron. Returns 1 if the student clicked "Accept".
    const choice = await window.electronAPI.showExamRules();
    if (choice !== 1) return; // student clicked Cancel — stay on setup screen
    setScreen("exam");
  }

  // =============================================================================
  // Exam submission — declared first so the auto-submit effect below can call it
  // =============================================================================

  async function submitExam(isAutoSubmit) {
    // Prevent a double-submission if the student clicks Submit at the same moment
    // the timer fires. The ref is updated synchronously, so both paths see it.
    if (submittedRef.current) return;
    setSubmitted(true);
    submittedRef.current = true;

    // Read the latest answers and events from refs, not from state,
    // because state may not have updated yet when called from the timer.
    const finalAnswers = answersRef.current;
    const finalEvents  = monitoringRef.current;

    // Score each question against the answer key.
    let correct = 0;
    const answerDetails = QUESTIONS.map((q, i) => {
      const selected   = finalAnswers[i];
      const isAnswered = selected !== undefined;
      const isCorrect  = isAnswered && selected === ANSWER_KEY[i];
      if (isCorrect) correct++;
      return {
        question:       q.text,
        selectedOption: isAnswered ? q.options[selected] : null,
        correctOption:  q.options[ANSWER_KEY[i]],
        isCorrect,
        unanswered:     !isAnswered,
      };
    });

    const answeredCount = Object.keys(finalAnswers).length;
    const submittedAt   = new Date().toISOString();

    const resultData = {
      submittedAt,
      autoSubmitted:   isAutoSubmit,
      totalQuestions:  QUESTIONS.length,
      answered:        answeredCount,
      unanswered:      QUESTIONS.length - answeredCount,
      score:           correct,
      answerDetails,
      monitoringEvents: finalEvents,
    };

    // Ask the main process to save the result file.
    setSaveError("");
    const saveRes = await window.electronAPI.saveResult(resultData);

    setResults({
      ...resultData,
      savedPath: saveRes.ok ? saveRes.path : null,
    });

    if (!saveRes.ok) {
      setSaveError("Result could not be saved: " + saveRes.error);
    }

    stopCamera();
    setScreen("results");
  }

  // Ask for confirmation before a manual submission.
  async function handleManualSubmit() {
    const confirmed = window.confirm(
      "Are you sure you want to submit the exam?\n\nYou cannot change your answers after submission."
    );
    if (confirmed) {
      await submitExam(false);
    }
  }

  // =============================================================================
  // Countdown timer — starts once, when the screen changes to "exam"
  // =============================================================================

  useEffect(() => {
    if (screen !== "exam") return;

    const id = setInterval(() => {
      // Functional update: React guarantees prev is always the latest value,
      // which avoids the stale-closure problem inside setInterval.
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Clean up the interval if the component unmounts or if screen changes.
    return () => clearInterval(id);
  }, [screen]); // Re-run only when screen changes, not on every render.

  // When timeLeft reaches 0 and the exam has not been submitted yet, auto-submit.
  useEffect(() => {
    if (screen === "exam" && timeLeft === 0 && !submitted) {
      submitExam(true);
    }
    // submitExam is intentionally excluded from the dependency array.
    // It reads from refs (not state), so it is always up-to-date regardless of
    // which render created it. Adding it would cause spurious re-subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, timeLeft, submitted]);

  // =============================================================================
  // Camera snapshot loop — runs while the exam is active
  // =============================================================================

  useEffect(() => {
    if (screen !== "exam") return;

    const id = setInterval(async () => {
      if (!imageCaptureRef.current) return;
      try {
        const blob   = await imageCaptureRef.current.takePhoto();
        const buffer = await blob.arrayBuffer();
        await window.electronAPI.savePhoto(buffer);
      } catch {
        // If a snapshot fails, log it in the main process and continue quietly.
      }
    }, 5000); // one photo every 5 seconds

    return () => clearInterval(id);
  }, [screen]);

  // =============================================================================
  // Tab-switch monitoring — active only during the exam
  // =============================================================================

  useEffect(() => {
    if (screen !== "exam") return;

    function handleVisibilityChange() {
      // document.hidden is true when the student switches to another window or tab.
      if (document.hidden && !submittedRef.current) {
        setMonitoringEvents((prev) => [
          ...prev,
          { timestamp: new Date().toISOString() },
        ]);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Remove the listener when the exam ends so it does not fire on the results screen.
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [screen]);

  // =============================================================================
  // Answer selection
  // =============================================================================

  function selectAnswer(optionIndex) {
    setAnswers((prev) => ({ ...prev, [currentQ]: optionIndex }));
  }

  // =============================================================================
  // Render: Setup screen
  // =============================================================================

  if (screen === "setup") {
    return (
      <>
        {/*
          The <video> element must stay in the DOM at all times so the camera
          stream can be assigned to it. Before camera access is granted it is
          invisible; after it is granted on the setup screen it shows a small
          preview in the corner so the student can confirm the camera works.
        */}
        <video
          ref={videoRef}
          autoPlay
          muted
          className={cameraGranted ? "video-preview" : "hidden-video"}
        />

        <div className="page-container">
          <div className="header-section">
            <h1>Welcome to Athna</h1>
            <p>Complete the steps below before starting your exam.</p>
          </div>

          <div className="card-container">
            {/* ── Step 1: Camera ──────────────────────────────────────────── */}
            <div className="permission-item">
              <div className="permission-icon">📷</div>
              <div className="permission-content">
                <h3>Enable Camera</h3>
                <p>
                  Camera access is required for this exam. Periodic snapshots
                  will be taken throughout the session.
                </p>

                {/* Show an error if camera access was denied or unavailable */}
                {cameraError && (
                  <p className="error-message">{cameraError}</p>
                )}

                {cameraGranted ? (
                  <p className="success-message">✓ Camera access granted.</p>
                ) : (
                  <div className="action-row">
                    <button onClick={requestCamera} className="btn btn-dark">
                      Allow Camera Access
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="divider" />

            {/* ── Step 2: Full screen ──────────────────────────────────────── */}
            <div className="permission-item">
              <div className="permission-icon">⛶</div>
              <div className="permission-content">
                <h3>Enter Full Screen</h3>
                <p>
                  The application will enter full-screen mode. Do not minimize
                  or switch to another window during the exam.
                </p>
                <button
                  onClick={() => window.electronAPI.setFullScreen()}
                  className="btn btn-light-blue"
                >
                  Enter Full Screen
                </button>
              </div>
            </div>
          </div>

          <div className="bottom-actions">
            {/*
              The Start Exam button is disabled until camera access is granted.
              The title attribute shows a tooltip explaining why it is disabled.
            */}
            <button
              onClick={handleStartExam}
              className="btn btn-light-blue"
              disabled={!cameraGranted}
              title={!cameraGranted ? "Please allow camera access before starting." : ""}
            >
              Start Exam
            </button>
          </div>
        </div>
      </>
    );
  }

  // =============================================================================
  // Render: Exam screen
  // =============================================================================

  if (screen === "exam") {
    const question     = QUESTIONS[currentQ];
    const answeredCount = Object.keys(answers).length;

    return (
      <>
        {/* Keep the video element alive off-screen so snapshots keep working */}
        <video ref={videoRef} autoPlay muted className="hidden-video" />

        <div className="exam-page">
          <div className="exam-container">

            {/* ── Top bar ─────────────────────────────────────────────────── */}
            <div className="exam-header">
              <h3>
                Question {currentQ + 1} of {QUESTIONS.length}
                &nbsp;·&nbsp;
                Answered: {answeredCount} / {QUESTIONS.length}
              </h3>

              <div className="exam-header-right">
                {/* Timer turns red when less than 60 seconds remain */}
                <span className={`timer${timeLeft <= 60 ? " timer-warning" : ""}`}>
                  ⏱ {formatTime(timeLeft)}
                </span>

                {/* Warning badge appears as soon as any tab-switch is detected */}
                {monitoringEvents.length > 0 && (
                  <span className="monitoring-badge">
                    ⚠ {monitoringEvents.length} tab-switch
                    {monitoringEvents.length !== 1 ? "es" : ""} detected
                  </span>
                )}

                <button onClick={handleManualSubmit} className="end-test-btn">
                  Submit Exam
                </button>
              </div>
            </div>

            {/* ── Question card ───────────────────────────────────────────── */}
            <div className="question-card">
              <h2>Question {currentQ + 1}</h2>
              <p>{question.text}</p>

              {/*
                Each option is a <label> wrapping a radio input.
                Clicking anywhere on the label (including the text) selects it.
                The `name` attribute ensures only one option per question is selected.
              */}
              {question.options.map((option, i) => (
                <label key={i} className="option-row">
                  <input
                    type="radio"
                    name={`question-${currentQ}`}
                    checked={answers[currentQ] === i}
                    onChange={() => selectAnswer(i)}
                  />
                  {option}
                </label>
              ))}
            </div>

            {/* ── Navigation ──────────────────────────────────────────────── */}
            <div className="exam-navigation">
              <button
                className="nav-btn"
                onClick={() => setCurrentQ((q) => q - 1)}
                disabled={currentQ === 0}
              >
                ← Previous
              </button>

              {/* Question-number dots let the student jump to any question */}
              <div className="question-dots">
                {QUESTIONS.map((_, i) => {
                  // Build the class list for each dot based on its state
                  const classes = ["dot"];
                  if (i === currentQ)          classes.push("dot-current");
                  if (answers[i] !== undefined) classes.push("dot-answered");
                  return (
                    <button
                      key={i}
                      className={classes.join(" ")}
                      onClick={() => setCurrentQ(i)}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>

              <button
                className="nav-btn"
                onClick={() => setCurrentQ((q) => q + 1)}
                disabled={currentQ === QUESTIONS.length - 1}
              >
                Next →
              </button>
            </div>

          </div>
        </div>
      </>
    );
  }

  // =============================================================================
  // Render: Results screen
  // =============================================================================

  if (screen === "results" && results) {
    return (
      <div className="results-page">
        <div className="results-container">
          <h1 className="results-title">Exam Submitted</h1>

          {results.autoSubmitted && (
            <p className="auto-submit-note">
              Time ran out — the exam was submitted automatically.
            </p>
          )}

          {/* Large score display */}
          <div className="results-card">
            <div className="score-big">
              {results.score} / {results.totalQuestions}
            </div>
            <p className="score-label">Your Score</p>
          </div>

          {/* Summary table */}
          <div className="results-detail-card">
            <table className="results-table">
              <tbody>
                <tr><td>Total Questions</td>        <td>{results.totalQuestions}</td></tr>
                <tr><td>Answered</td>               <td>{results.answered}</td></tr>
                <tr><td>Unanswered</td>             <td>{results.unanswered}</td></tr>
                <tr><td>Correct</td>                <td>{results.score}</td></tr>
                <tr><td>Incorrect</td>              <td>{results.answered - results.score}</td></tr>
                <tr><td>Tab-switch events</td>      <td>{results.monitoringEvents.length}</td></tr>
                <tr><td>Submitted at</td>           <td>{new Date(results.submittedAt).toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>

          {/* Per-question answer breakdown */}
          <div className="results-detail-card">
            <h3 className="breakdown-heading">Answer Breakdown</h3>
            {results.answerDetails.map((detail, i) => (
              <div
                key={i}
                className={`answer-row ${
                  detail.unanswered ? "unanswered" : detail.isCorrect ? "correct" : "incorrect"
                }`}
              >
                <span className="answer-q">Q{i + 1}. {detail.question}</span>
                <span className="answer-a">
                  {detail.unanswered
                    ? "Not answered"
                    : detail.isCorrect
                    ? `✓ ${detail.selectedOption}`
                    : `✗ ${detail.selectedOption}  (Correct: ${detail.correctOption})`}
                </span>
              </div>
            ))}
          </div>

          {/* File save status — shown only after a successful or failed write */}
          {saveError ? (
            <p className="error-message save-status">⚠ {saveError}</p>
          ) : results.savedPath ? (
            <p className="success-message save-status">
              ✓ Result saved to: <code>{results.savedPath}</code>
            </p>
          ) : null}

        </div>
      </div>
    );
  }

  // Fallback — should never reach this point in normal use
  return null;
}

export default App;
