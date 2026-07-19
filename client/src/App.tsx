import { useEffect, useState } from 'react'
import type { GameState } from './types'
import LoginScreen from './LoginScreen'
import SignupScreen from './SignupScreen'
import SavesScreen from './SavesScreen'
import CharacterSelectScreen from './CharacterSelectScreen'
import GameScreen from './GameScreen'
import SettingsScreen from './SettingsScreen'
import RecapScreen from './RecapScreen'
import RecapHistoryScreen from './RecapHistoryScreen'
import AuthoringScreen from './AuthoringScreen'
import ArtAdminScreen from './ArtAdminScreen'
import ChapterArtScreen from './ChapterArtScreen'

type Screen = 'booting' | 'login' | 'signup' | 'saves' | 'select' | 'settings' | 'game' | 'recap' | 'recapHistory' | 'authoring' | 'artAdmin' | 'chapterArt'

export default function App() {
  const [screen, setScreen] = useState<Screen>('booting')
  // Tracked through login/signup/logout; not yet displayed anywhere (value unread).
  const [, setUsername] = useState<string | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [artPlaythroughId, setArtPlaythroughId] = useState<string | null>(null)

  // Boot: check auth, then check for an existing playthrough.
  useEffect(() => {
    ;(async () => {
      try {
        const meRes = await fetch('/api/auth/me')
        if (!meRes.ok) {
          setScreen('login')
          return
        }
        const meData = await meRes.json()
        setUsername(meData.user?.username ?? null)

        // See if there's already an active playthrough (pid cookie).
        const stateRes = await fetch('/api/state')
        if (stateRes.ok) {
          setGameState(await stateRes.json())
          setScreen('game')
        } else {
          setScreen('saves')
        }
      } catch {
        setScreen('login')
      }
    })()
  }, [])

  // ── Auth callbacks ────────────────────────────────────────────────────────

  function handleLogin(uname: string) {
    setUsername(uname)
    // After login, check for an existing playthrough (pid cookie).
    // Usually there won't be one — the user just logged in — so go to saves.
    fetch('/api/state')
      .then(async (res) => {
        if (res.ok) {
          setGameState(await res.json())
          setScreen('game')
        } else {
          setScreen('saves')
        }
      })
      .catch(() => setScreen('saves'))
  }

  function handleSignup(uname: string) {
    setUsername(uname)
    // New account — definitely no playthrough yet. Go straight to saves.
    setScreen('saves')
  }

  function handleLogout() {
    setUsername(null)
    setGameState(null)
    setScreen('login')
  }

  // ── Saves callbacks ───────────────────────────────────────────────────────

  function handleResume(state: GameState) {
    setGameState(state)
    setScreen('game')
  }

  function handleGoToSelect() {
    setScreen('select')
  }

  function handleCharacterPicked(state: GameState) {
    setGameState(state)
    setScreen('game')
  }

  function handleGoToSettings() {
    setScreen('settings')
  }

  function handleChapterComplete() {
    setScreen('recap')
  }

  function handleManageArt() {
    setScreen('artAdmin')
  }

  function handleChapterArt(playthroughId: string) {
    setArtPlaythroughId(playthroughId)
    setScreen('chapterArt')
  }

  function handleRecapHistory() {
    setScreen('recapHistory')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (screen === 'booting') {
    return (
      <div className="flex min-h-[100svh] items-center justify-center text-text-muted">
        Loading…
      </div>
    )
  }

  if (screen === 'login') {
    return <LoginScreen onLogin={handleLogin} onGoToSignup={() => setScreen('signup')} />
  }

  if (screen === 'signup') {
    return <SignupScreen onSignup={handleSignup} onGoToLogin={() => setScreen('login')} />
  }

  if (screen === 'saves') {
    return <SavesScreen onResume={handleResume} onStartNew={handleGoToSelect} onSettings={handleGoToSettings} onLogout={handleLogout} onAuthor={() => setScreen('authoring')} onManageArt={handleManageArt} onChapterArt={handleChapterArt} />
  }

  if (screen === 'authoring') {
    return <AuthoringScreen onBack={() => setScreen('saves')} />
  }

  if (screen === 'artAdmin') {
    return <ArtAdminScreen onBack={() => setScreen('saves')} />
  }

  if (screen === 'chapterArt' && artPlaythroughId) {
    return (
      <ChapterArtScreen
        playthroughId={artPlaythroughId}
        onBack={() => {
          setArtPlaythroughId(null)
          setScreen('saves')
        }}
      />
    )
  }

  if (screen === 'select') {
    return <CharacterSelectScreen onStart={handleCharacterPicked} onBack={() => setScreen('saves')} />
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('saves')} />
  }

  if (screen === 'recap') {
    return (
      <RecapScreen
        onBackToSaves={() => setScreen('saves')}
        onContinue={handleCharacterPicked}
      />
    )
  }

  if (screen === 'recapHistory') {
    return <RecapHistoryScreen onResume={handleResume} />
  }

  // screen === 'game'
  if (gameState) {
    return (
      <GameScreen
        initialState={gameState}
        onLogout={handleLogout}
        onSettings={handleGoToSettings}
        onChapterComplete={handleChapterComplete}
        onBackToSaves={() => setScreen('saves')}
        onRecapHistory={handleRecapHistory}
      />
    )
  }

  // Fallback (shouldn't happen): no game state but screen is 'game'.
  return (
    <div className="flex min-h-[100svh] items-center justify-center text-text-muted">
      Something went wrong.{' '}
      <button onClick={handleLogout} className="ml-2 underline">
        Start over
      </button>
    </div>
  )
}
