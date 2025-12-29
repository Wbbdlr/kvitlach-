defmodule Kurten.Round do
  alias Kurten.Turn
  alias Kurten.Deck
  alias Kurten.Room
  alias Phoenix.PubSub
  #

  defstruct [:round_id, :room_id, :deck, turns: [], balances: [], state: :playing]

  # round should close itself if inactive for an hour

  use GenServer

  def init(attrs) do
    players = attrs[:players]
    iterations = div(length(players), 6)

    deck = for _ <- 0..iterations, do: Deck.new()
    deck = List.flatten(deck)

    [turns: turns, deck: deck] = Turn.initialize(attrs[:players], deck)

    {:ok,
     %Kurten.Round{
       deck: deck,
       state: :playing,
       turns: turns,
       round_id: attrs[:round_id],
       room_id: attrs[:room_id]
     }}
  end

  def handle_cast({:standby, turn}, state) do
    turn = Map.put(turn, :state, :standby)
    turns = merge_turn(state.turns, turn)
    state = Map.put(state, :turns, turns)

    case get_game_state(turns) do
      :terminate ->
        turns = calculate_end_state(turns)
        state = Map.merge(state, %{turns: turns, state: :terminate})
        broadcast(state)
        Process.send_after(self(), :terminate_game, 20000)
        {:noreply, state}

      game_state ->
        state = Map.put(state, :state, game_state)
        broadcast(state)
        {:noreply, state}
    end
  end

  def handle_cast({:skip, turn}, state) do
    turn = Map.put(turn, :state, :skipped)
    turns = merge_turn(state.turns, turn)
    state = Map.put(state, :turns, turns)

    case get_game_state(turns) do
      :terminate ->
        turns = calculate_end_state(turns)
        state = Map.merge(state, %{turns: turns, state: :terminate})
        broadcast(state)
        Process.send_after(self(), :terminate_game, 5000)
        {:noreply, state}

      game_state ->
        state = Map.put(state, :state, game_state)
        broadcast(state)
        {:noreply, state}
    end
  end

  def handle_cast({:bet, turn, amount}, state) do
    [picked_card | rest] = state.deck

    turn =
      Map.merge(
        turn,
        %{
          cards: [picked_card | turn.cards],
          bet: amount,
          state: Turn.calc_state([picked_card | turn.cards])
        }
      )

    turns = merge_turn(state.turns, turn)
    state = Map.merge(state, %{turns: turns, deck: rest})

    case get_game_state(turns) do
      :terminate ->
        turns = calculate_end_state(turns)
        state = Map.merge(state, %{turns: turns, state: :terminate})
        broadcast(state)
        Process.send_after(self(), :terminate_game, 5000)
        {:noreply, state}

      game_state ->
        state = Map.put(state, :state, game_state)
        broadcast(state)
        {:noreply, state}
    end
  end

  @spec get_game_state([any()]) :: {:ok, any()} | :terminate
  def get_game_state(turns) do
    # if there isn't a player anymore, return :terminate else next_turn
    pending_turns = Enum.filter(turns, &(&1.state == :pending and &1.player.type != "admin"))
    admin_turn = Enum.find(turns, &(&1.player.type == "admin"))
    standing_turns = Enum.filter(turns, &(&1.state == :standby))

    cond do
      # only the admin remains
      length(pending_turns) == 0 and length(standing_turns) > 0 and admin_turn.state == :pending ->
        :final

      # everybody played and nobody standing
      length(pending_turns) == 0 ->
        :terminate

      # there are still other players
      true ->
        :playing
    end
  end

  def broadcast(state) do
    PubSub.broadcast(Kurten.PubSub, "round:#{state.round_id}",
      turns: state.turns,
      state: state.state
    )
  end

  def handle_call({:leave, player_id}, _from, state) do
    players = Enum.filter(state.players, &(&1 != player_id))
    {:reply, :ok, Map.put(state, :players, players)}
  end

  def handle_call(:round, _from, state) do
    {:reply, state, state}
  end

  #  terminate game when admin stands or lost.
  def handle_info(:terminate_game, state) do
    balances = calculate_balances(state.turns)
    PubSub.broadcast(Kurten.PubSub, "round:#{state.round_id}", :round_terminated)
    GenServer.cast(Room.via_tuple(state.room_id), {:round_complete, balances})
    Process.exit(self(), :normal)
  end

  #  add to calculate win or loose
  defp calculate_balances(turns) do
    %{admin: admin_turn, players: player_turns} =
      Enum.reduce(Enum.filter(turns, &(&1.state != :skipped)), %{players: []}, fn turn, acc ->
        if turn.player.type == "admin" do
          Map.put(acc, :admin, turn)
        else
          Map.put(acc, :players, [turn | acc.players])
        end
      end)

    Enum.map(player_turns, fn turn ->
      case turn.state do
        :lost -> %{amount: turn.bet, payee: admin_turn.player.id, payer: turn.player.id}
        :won -> %{amount: turn.bet, payer: admin_turn.player.id, payee: turn.player.id}
      end
    end)
  end

  #  turns -> %{turns, balances}
  def calculate_end_state(turns) do
    %{admin: admin_turn, players: player_turns} =
      Enum.reduce(turns, %{players: []}, fn turn, acc ->
        if turn.player.type == "admin" do
          Map.put(acc, :admin, turn)
        else
          Map.put(acc, :players, [turn | acc.players])
        end
      end)

    {player_turns, admin_balance} =
      Enum.map_reduce(player_turns, 0, fn turn, admin_balance ->
        state =
          case turn.state do
            :standby -> if player_won?(admin_turn, turn), do: :won, else: :lost
            state -> state
          end

        turn = Map.put(turn, :state, state)

        case turn.state do
          :won -> {turn, admin_balance - turn.bet}
          :lost -> {turn, admin_balance + turn.bet}
          _ -> {turn, admin_balance}
        end
      end)

    admin_turn = Map.put(admin_turn, :bet, admin_balance)
    [admin_turn | player_turns]
  end

  defp player_won?(admin_turn, player_turn) do
    player_total = get_winning_number(player_turn.cards)
    admin_total = get_winning_number(admin_turn.cards)
    player_total > (admin_total || 0)
  end

  def get_winning_number(cards) do
    Turn.get_sums(cards) |> Enum.filter(&(&1 <= 21)) |> Enum.sort(&(&1 > &2)) |> Enum.at(0)
  end

  defp merge_turn(turns, turn) do
    Enum.map(turns, fn t ->
      if t.player.id == turn.player.id do
        turn
      else
        t
      end
    end)
  end

  #  callbacks
  def get_info(round_id) when is_binary(round_id) do
    try do
      round = GenServer.call(via_tuple(round_id), :round)
      {:ok, round}
    rescue
      _e -> {:error, :not_found}
    end
  end

  def get_info(_) do
    {:error, :not_found}
  end

  def place_bet(round_id, turn, amount) do
    GenServer.cast(via_tuple(round_id), {:bet, turn, amount})
  end

  def stand(round_id, turn) do
    GenServer.cast(via_tuple(round_id), {:standby, turn})
  end

  def skip(round_id, turn) do
    GenServer.cast(via_tuple(round_id), {:skip, turn})
  end

  defp via_tuple(round_id) do
    {:via, Registry, {Kurten.RoundRegistry, round_id}}
  end
end
