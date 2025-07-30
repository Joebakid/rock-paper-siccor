"use server"

import { createClient } from "@supabase/supabase-js"

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

console.log("SUPABASE_URL:", supabaseUrl ? "Set" : "Not Set")
console.log("SUPABASE_ANON_KEY:", supabaseAnonKey ? "Set" : "Not Set")

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables!")
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Define types for our game state
interface Game {
  id: string
  player1_id: string | null
  player2_id: string | null
  player1_choice: "rock" | "paper" | "scissors" | null
  player2_choice: "rock" | "paper" | "scissors" | null
  player1_score: number
  player2_score: number
  last_result: string | null
  status: "waiting" | "playing" | "finished"
}

// Helper to determine the winner
const determineWinner = (
  player1Choice: "rock" | "paper" | "scissors" | null,
  player2Choice: "rock" | "paper" | "scissors" | null,
): "player1" | "player2" | "draw" | null => {
  if (!player1Choice || !player2Choice) return null

  if (player1Choice === player2Choice) {
    return "draw"
  } else if (
    (player1Choice === "rock" && player2Choice === "scissors") ||
    (player1Choice === "paper" && player2Choice === "rock") ||
    (player1Choice === "scissors" && player2Choice === "paper")
  ) {
    return "player1"
  } else {
    return "player2"
  }
}

export async function createGame(userId: string) {
  const { data, error } = await supabase
    .from("games")
    .insert({ player1_id: userId, status: "waiting" })
    .select()
    .single()

  if (error) {
    console.error("Error creating game:", error)
    return { error: error.message }
  }
  console.log(`Game created: ${data.id} by player ${userId}`)
  return { gameId: data.id, playerId: userId, playerNumber: 1 }
}

export async function joinGame(gameId: string, userId: string) {
  const { data: game, error: fetchError } = await supabase.from("games").select("*").eq("id", gameId).single()

  if (fetchError || !game) {
    console.error("Error fetching game to join:", fetchError)
    return { error: "Game not found" }
  }
  if (game.player1_id === userId || game.player2_id === userId) {
    // User is already part of this game, just return current state
    const playerNumber = game.player1_id === userId ? 1 : 2
    return { gameId: game.id, playerId: userId, playerNumber }
  }
  if (game.player2_id) {
    return { error: "Game is already full" }
  }

  const { data, error: updateError } = await supabase
    .from("games")
    .update({ player2_id: userId, status: "playing" })
    .eq("id", gameId)
    .select()
    .single()

  if (updateError) {
    console.error("Error joining game:", updateError)
    return { error: updateError.message }
  }
  console.log(`Player ${userId} joined game ${gameId}`)
  return { gameId: data.id, playerId: userId, playerNumber: 2 }
}

export async function makeMove(gameId: string, playerId: string, choice: "rock" | "paper" | "scissors") {
  const { data: game, error: fetchError } = await supabase.from("games").select("*").eq("id", gameId).single()

  if (fetchError || !game) {
    console.error("Error fetching game for move:", fetchError)
    return { error: "Game not found" }
  }

  const updateData: Partial<Game> = {}
  let isPlayer1 = false
  if (game.player1_id === playerId) {
    updateData.player1_choice = choice
    isPlayer1 = true
  } else if (game.player2_id === playerId) {
    updateData.player2_choice = choice
  } else {
    return { error: "Invalid player for this game" }
  }

  // If both players have made a choice, determine winner and update scores
  const player1CurrentChoice = isPlayer1 ? choice : game.player1_choice
  const player2CurrentChoice = !isPlayer1 ? choice : game.player2_choice

  if (player1CurrentChoice && player2CurrentChoice) {
    const winner = determineWinner(player1CurrentChoice, player2CurrentChoice)
    if (winner === "player1") {
      updateData.player1_score = game.player1_score + 1
      updateData.last_result = "Player 1 wins this round!"
    } else if (winner === "player2") {
      updateData.player2_score = game.player2_score + 1
      updateData.last_result = "Player 2 wins this round!"
    } else {
      updateData.last_result = "It's a draw!"
    }
    // Reset choices for the next round
    updateData.player1_choice = null
    updateData.player2_choice = null
  } else {
    updateData.last_result = null // Clear result if only one player has moved
  }

  const { error: updateError } = await supabase.from("games").update(updateData).eq("id", gameId)

  if (updateError) {
    console.error("Error making move:", updateError)
    return { error: updateError.message }
  }
  console.log(`Player ${playerId} made move ${choice} in game ${gameId}`)
  return { success: true }
}

export async function getGameState(gameId: string) {
  const { data: game, error } = await supabase.from("games").select("*").eq("id", gameId).single()

  if (error || !game) {
    console.error("Error getting game state:", error)
    return { error: "Game not found" }
  }
  return { game }
}

export async function resetGame(gameId: string) {
  const { data: game, error: fetchError } = await supabase.from("games").select("*").eq("id", gameId).single()

  if (fetchError || !game) {
    console.error("Error fetching game to reset:", fetchError)
    return { error: "Game not found" }
  }

  const { error: updateError } = await supabase
    .from("games")
    .update({
      player1_choice: null,
      player2_choice: null,
      player1_score: 0,
      player2_score: 0,
      last_result: null,
      status: game.player2_id ? "playing" : "waiting", // If player 2 exists, game is still playing
    })
    .eq("id", gameId)

  if (updateError) {
    console.error("Error resetting game:", updateError)
    return { error: updateError.message }
  }
  console.log(`Game ${gameId} reset`)
  return { success: true }
}

export async function getAvailableGames() {
  const { data: games, error } = await supabase
    .from("games")
    .select("id, player1_id, created_at")
    .is("player2_id", null) // Only show games waiting for a second player
    .eq("status", "waiting")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching available games:", error)
    return { error: error.message, games: [] }
  }
  return { games }
}
