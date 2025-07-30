"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { createGame, joinGame, makeMove, getGameState, resetGame, getAvailableGames } from "@/actions/game"
import { createClient, type SupabaseClient } from "@supabase/supabase-js" // Import SupabaseClient type
import { v4 as uuidv4 } from "uuid"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

type Choice = "rock" | "paper" | "scissors" | null

interface GameState {
  id: string
  player1_id: string | null
  player2_id: string | null
  player1_choice: Choice
  player2_choice: Choice
  player1_score: number
  player2_score: number
  last_result: string | null
  status: "waiting" | "playing" | "finished"
}

interface AvailableGame {
  id: string
  player1_id: string
  created_at: string
}

export default function RockPaperScissorsGame() {
  const [userId, setUserId] = useState<string | null>(null)
  const [gameId, setGameId] = useState<string | null>(null)
  const [playerNumber, setPlayerNumber] = useState<1 | 2 | null>(null)
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(null)
  const [availableGames, setAvailableGames] = useState<AvailableGame[]>([])
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"lobby" | "game">("lobby")
  const [joinGameInput, setJoinGameInput] = useState<string>("")
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null) // State for Supabase client

  const choices: Choice[] = ["rock", "paper", "scissors"]

  // Initialize userId from localStorage or create a new one
  useEffect(() => {
    let storedUserId = localStorage.getItem("rps_userId")
    if (!storedUserId) {
      storedUserId = uuidv4()
      localStorage.setItem("rps_userId", storedUserId)
    }
    setUserId(storedUserId)

    // Initialize Supabase client only on the client-side
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables!")
      // Optionally, set an error state here to inform the user
      setError("Supabase configuration missing. Please check environment variables.")
      return
    }
    setSupabaseClient(createClient(supabaseUrl, supabaseAnonKey))
  }, [])

  // Fetch available games for the lobby
  const fetchAvailableGames = useCallback(async () => {
    setError(null)
    const { games, error } = await getAvailableGames()
    if (error) {
      setError(error)
      return
    }
    setAvailableGames(games as AvailableGame[])
  }, [])

  useEffect(() => {
    if (viewMode === "lobby") {
      fetchAvailableGames()
      const interval = setInterval(fetchAvailableGames, 5000) // Refresh lobby every 5 seconds
      return () => clearInterval(interval)
    }
  }, [viewMode, fetchAvailableGames])

  // Supabase Realtime subscription for game state
  useEffect(() => {
    if (!gameId || !supabaseClient) return // Ensure supabaseClient is initialized

    const channel = supabaseClient.channel(`game:${gameId}`)

    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` },
        (payload) => {
          console.log("Realtime change received:", payload)
          setCurrentGameState(payload.new as GameState)
        },
      )
      .subscribe()

    // Initial fetch when gameId is set
    const fetchInitialGameState = async () => {
      const { game, error } = await getGameState(gameId)
      if (error) {
        setError(error)
        setGameId(null) // Go back to lobby if game not found
        setViewMode("lobby")
        return
      }
      setCurrentGameState(game)
    }
    fetchInitialGameState()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [gameId, supabaseClient]) // Add supabaseClient to dependency array

  const handleCreateGame = async () => {
    setError(null)
    if (!userId) {
      setError("User ID not initialized. Please refresh.")
      return
    }
    const { gameId: newGameId, playerId: newPlayerId, playerNumber: newPlayerNumber, error } = await createGame(userId)
    if (error) {
      setError(error)
      return
    }
    setGameId(newGameId)
    setPlayerId(newPlayerId)
    setPlayerNumber(newPlayerNumber)
    setViewMode("game")
  }

  const handleJoinGame = async (idToJoin: string) => {
    setError(null)
    if (!userId) {
      setError("User ID not initialized. Please refresh.")
      return
    }
    const {
      gameId: joinedGameId,
      playerId: joinedPlayerId,
      playerNumber: joinedPlayerNumber,
      error,
    } = await joinGame(idToJoin, userId)
    if (error) {
      setError(error)
      return
    }
    setGameId(joinedGameId)
    setPlayerId(joinedPlayerId)
    setPlayerNumber(joinedPlayerNumber)
    setViewMode("game")
  }

  const handleMakeMove = async (choice: Choice) => {
    setError(null)
    if (!gameId || !playerId || !choice) return

    const { error } = await makeMove(gameId, playerId, choice)
    if (error) {
      setError(error)
      return
    }
    // State will be updated by Realtime, no need to manually update here
  }

  const handleResetGame = async () => {
    setError(null)
    if (!gameId) return
    const { success, error } = await resetGame(gameId)
    if (error) {
      setError(error)
      return
    }
    // State will be updated by Realtime
  }

  const getPlayerChoice = () => {
    if (!currentGameState) return null
    return playerNumber === 1 ? currentGameState.player1_choice : currentGameState.player2_choice
  }

  const getOpponentChoice = () => {
    if (!currentGameState) return null
    return playerNumber === 1 ? currentGameState.player2_choice : currentGameState.player1_choice
  }

  const isMyTurnToMove = () => {
    if (!currentGameState || !playerNumber) return false
    if (playerNumber === 1) {
      return currentGameState.player1_choice === null
    } else {
      return currentGameState.player2_choice === null
    }
  }

  const isOpponentWaiting = () => {
    if (!currentGameState || !playerNumber) return false
    if (playerNumber === 1) {
      return (
        currentGameState.player2_id &&
        currentGameState.player2_choice === null &&
        currentGameState.player1_choice !== null
      )
    } else {
      return (
        currentGameState.player1_id &&
        currentGameState.player1_choice === null &&
        currentGameState.player2_choice !== null
      )
    }
  }

  if (viewMode === "lobby") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
        <Card className="w-full max-w-md bg-white dark:bg-gray-800 shadow-lg rounded-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold text-gray-900 dark:text-white">Rock Paper Scissors</CardTitle>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Your Player ID: {userId}</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-4">
              <Button onClick={handleCreateGame} className="py-3 text-lg">
                Create New Game
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Enter Game ID to Join"
                  value={joinGameInput}
                  onChange={(e) => setJoinGameInput(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={() => handleJoinGame(joinGameInput)} className="py-3 text-lg">
                  Join Game
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Available Games</h3>
                <Button variant="ghost" size="sm" onClick={fetchAvailableGames}>
                  Refresh
                </Button>
              </div>
              {availableGames.length === 0 ? (
                <p className="text-gray-600 dark:text-gray-400 text-center">No games waiting. Create one!</p>
              ) : (
                <ScrollArea className="h-48 w-full rounded-md border p-4">
                  <ul className="space-y-2">
                    {availableGames.map((game) => (
                      <li key={game.id} className="flex justify-between items-center p-2 border rounded-md">
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          Game by {game.player1_id.substring(0, 8)}...
                        </span>
                        <Button onClick={() => handleJoinGame(game.id)} size="sm">
                          Join
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>
            {error && <p className="text-red-500 text-center">{error}</p>}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="link" className="w-full">
                  How to Play
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Rock Paper Scissors Rules</DialogTitle>
                  <DialogDescription>The classic game of chance!</DialogDescription>
                </DialogHeader>
                <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
                  <p>Each player chooses one of three shapes:</p>
                  <ul className="list-disc list-inside">
                    <li>Rock</li>
                    <li>Paper</li>
                    <li>Scissors</li>
                  </ul>
                  <p>The winner is determined by these rules:</p>
                  <ul className="list-disc list-inside">
                    <li>Rock crushes Scissors (Rock wins)</li>
                    <li>Paper covers Rock (Paper wins)</li>
                    <li>Scissors cuts Paper (Scissors wins)</li>
                  </ul>
                  <p>If both players choose the same shape, it's a draw!</p>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Game View
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md bg-white dark:bg-gray-800 shadow-lg rounded-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-gray-900 dark:text-white">Rock Paper Scissors</CardTitle>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Game ID: <span className="font-semibold">{gameId}</span>
          </p>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            You are: <span className="font-semibold">Player {playerNumber}</span> (ID: {playerId?.substring(0, 8)}...)
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {currentGameState.status === "waiting" && (
            <div className="text-center text-xl font-medium text-gray-700 dark:text-gray-300">
              Waiting for another player to join...
            </div>
          )}

          {currentGameState.status === "playing" && (
            <>
              <div className="flex justify-around gap-4">
                {choices.map((choice) => (
                  <Button
                    key={choice}
                    onClick={() => handleMakeMove(choice)}
                    className="flex-1 py-3 text-lg capitalize"
                    variant="outline"
                    disabled={!isMyTurnToMove()}
                  >
                    {choice}
                  </Button>
                ))}
              </div>

              <div className="text-center text-lg font-medium text-gray-700 dark:text-gray-300">
                <p>
                  Your choice:{" "}
                  <span className="font-semibold capitalize">
                    {getPlayerChoice() || (isMyTurnToMove() ? "..." : "Waiting for your move")}
                  </span>
                </p>
                <p>
                  Opponent's choice:{" "}
                  <span className="font-semibold capitalize">
                    {getOpponentChoice() || (isOpponentWaiting() ? "..." : "Waiting for opponent")}
                  </span>
                </p>
                {currentGameState.lastResult && (
                  <p className="mt-2 text-xl font-bold text-blue-600 dark:text-blue-400">
                    {currentGameState.lastResult}
                  </p>
                )}
              </div>

              <div className="flex justify-around text-xl font-semibold text-gray-800 dark:text-gray-200">
                <p>
                  Player 1 Score: <span className="text-green-500">{currentGameState.player1_score}</span>
                </p>
                <p>
                  Player 2 Score: <span className="text-red-500">{currentGameState.player2_score}</span>
                </p>
              </div>

              <div className="flex justify-center gap-4">
                <Button onClick={handleResetGame} className="px-6 py-3 text-lg" variant="secondary">
                  Reset Game
                </Button>
                <Button onClick={() => setViewMode("lobby")} className="px-6 py-3 text-lg" variant="outline">
                  Back to Lobby
                </Button>
              </div>
            </>
          )}
          {error && <p className="text-red-500 text-center">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
