defmodule KurtenWeb.RoundLive do
  use KurtenWeb, :live_view
  alias Kurten.Round
  alias Phoenix.PubSub
  alias Kurten.Room
  alias KurtenWeb.Presence

  @impl true
  def mount(_params, session, socket) do
    with {:ok, room, player} <-
           Room.get_info_for_player(session["room_id"], session["player_id"]),
         {:ok, round} <- Round.get_info(room.round_id),
         turn when not is_nil(turn) <-
           Enum.find(round.turns, fn turn -> turn.player.id == player.id end) do
      viewing_self = turn.player.id == player.id
      PubSub.subscribe(Kurten.PubSub, "round:#{room.round_id}")
      Presence.track(self(), "presence:#{session["room_id"]}", session["player_id"], %{})

      {:ok,
       assign(
         socket,
         turns: round.turns,
         added_bet: 0,
         viewing_self: viewing_self,
         turn: turn,
         round_state: round.state,
         player: player,
         round_id: round.round_id
       )
       |> assign(room_id: room.room_id)}
    else
      _ ->
        {:ok, push_navigate(socket, to: "/room")}
    end
  end

  @impl true
  def handle_event("place_bet", _params, socket) do
    turn = socket.assigns.turn
    Round.place_bet(socket.assigns.round_id, turn, turn.bet + socket.assigns.added_bet)
    {:noreply, assign(socket, added_bet: 0)}
  end

  def handle_event("view_player", %{"player_id" => player_id}, socket) do
    turn = Enum.find(socket.assigns.turns, fn turn -> turn.player.id == player_id end)
    viewing_self = turn.player.id == socket.assigns.player.id
    {:noreply, assign(socket, turn: turn, viewing_self: viewing_self)}
  end

  @impl true
  def handle_event("stand", _params, socket) do
    Round.stand(socket.assigns.round_id, socket.assigns.turn)
    {:noreply, socket}
  end

  @impl true
  def handle_event("bet_amount", %{"amount" => amount}, socket) do
    {:noreply, assign(socket, added_bet: String.to_integer(amount))}
  end

  def handle_event("skip", _params, socket) do
    Round.skip(socket.assigns.round_id, socket.assigns.turn)
    {:noreply, socket}
  end

  @impl true
  def handle_info(:round_terminated, socket) do
    {:noreply, push_navigate(socket, to: "/room")}
  end

  @impl true
  def handle_info([turns: turns, state: round_state], socket) do
    turn =
      if round_state == :final do
        Enum.find(turns, fn turn -> turn.player.type == "admin" end)
      else
        Enum.find(turns, fn turn -> turn.player.id == socket.assigns.turn.player.id end)
      end

    viewing_self = turn.player.id == socket.assigns.player.id

    assigns =
      [
        turns: turns,
        viewing_self: viewing_self,
        turn: turn,
        player: socket.assigns.player,
        round_state: round_state,
        round_id: socket.assigns.round_id
      ]

    {:noreply, assign(socket, assigns)}
  end

  @impl true
  def handle_info({:round_terminated, :inactivity_timeout}, socket) do
    {:noreply,
      socket
      |> put_flash(:info, "Game terminated due to inactivity")
      |> redirect(to: "/room")}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="flex flex-col h-full font-sans">
      <div class="text-center">
        <span class="text-blue-800 font-bold	"><%= player_name(@turn.player, @player) %></span>
      </div>
      <div class="flex flex-col flex-1 justify-center relative align-center items-center max-h-100">
        <%= cond do %>
          <% @turn.player.type == "admin" and not @viewing_self and @turn.state == :pending -> %>
            <.card_list cards={@turn.cards} reveal={:first} />
          <% (@viewing_self) or (@turn.state in [:lost, :won]) or (@turn.player.type == "admin") -> %>
            <.card_list cards={@turn.cards} reveal={:all} />
          <% true -> %>
            <.card_list cards={@turn.cards} reveal={:none} />
        <% end %>
        <div class="absolute top-1/2 text-center font-bold animate-pulse w-full font-bold text-6xl z-50">
          <%= if @turn.state == :won do %>
            <span class="text-green-700"><%= player_name(@turn.player, @player) %> won</span>
          <% end %>
          <%= if @turn.state == :lost do %>
            <span class="text-red-600 z-50">
              <%= player_name(@turn.player, @player) %> lost
            </span>
          <% end %>
          <%= if @turn.state == :standby do %>
            <span class="text-gray-600 z-50">Standing</span>
          <% end %>
        </div>
      </div>
      <%= if @viewing_self and @turn.state == :pending and (@player.type != "admin" or @round_state == :final) do %>
        <div class="mb-4 mt-2 h-1/5 relative">
          <div class="flex justify-center align-center px-10 h-1/2 pb-2">
            <%= if length(@turn.cards) > 1 do %>
              <button
                phx-click="stand"
                class="w-auto h-full max-h-20 border aspect-square text-center border-3 border-red-700 bg-white hover:bg-gray-200 text-red-700 font-bold py-2 mr-4 rounded-full"
              >
                Stand
              </button>
            <% end %>
            <button
              disabled={
                (@turn.bet + @added_bet == 0 and @turn.player.type != "admin") ||
                  @turn.state != :pending
              }
              phx-click="place_bet"
              class="w-auto h-full max-h-20 p-2 aspect-square disabled:opacity-20 text-white font-bold p-4  rounded-full bg-red-400"
            >
              Hit
            </button>
          </div>
          <%= if @player.type != "admin" do %>
            <.bet_amount bet={@turn.bet} added_bet={@added_bet} />
          <% end %>
          <div phx-hook="VoiceCall" id="voice_call" phx-update="ignore" data-view="round">
            <button
              id="toggle-mute"
              class="absolute bottom-0 select-none right-2 rounded-full w-12 h-12 text-center flex align-center justify-center items-center bg-gray-100 border shadow-xl"
            >
              <svg
                id="unmuted"
                class="hidden bg-white"
                xmlns="http://www.w3.org/2000/svg"
                height="16"
                width="12"
                viewBox="0 0 384 512"
              >
                <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                <path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z" />
              </svg>
              <svg
                id="muted"
                class="bg-gray-100 hidden"
                xmlns="http://www.w3.org/2000/svg"
                height="16"
                width="20"
                viewBox="0 0 640 512"
              >
                <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L472.1 344.7c15.2-26 23.9-56.3 23.9-88.7V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 21.2-5.1 41.1-14.2 58.7L416 300.8V96c0-53-43-96-96-96s-96 43-96 96v54.3L38.8 5.1zm362.5 407l-43.1-33.9C346.1 382 333.3 384 320 384c-70.7 0-128-57.3-128-128v-8.7L144.7 210c-.5 1.9-.7 3.9-.7 6v40c0 89.1 66.2 162.7 152 174.4V464H248c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H344V430.4c20.4-2.8 39.7-9.1 57.3-18.2z" />
              </svg>
            </button>
          </div>
        </div>
      <% else %>
        <div class="mb-4 mt-2 h-1/7 relative">
          <div phx-hook="VoiceCall" id="voice_call" phx-update="ignore" data-view="round">
            <button
              id="toggle-mute"
              class="absolute bottom-0 select-none right-2 rounded-full w-12 h-12 text-center flex align-center justify-center items-center bg-gray-100 border shadow-xl"
            >
              <svg
                id="unmuted"
                class="hidden bg-white"
                xmlns="http://www.w3.org/2000/svg"
                height="16"
                width="12"
                viewBox="0 0 384 512"
              >
                <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                <path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z" />
              </svg>
              <svg
                id="muted"
                class="bg-gray-100"
                xmlns="http://www.w3.org/2000/svg"
                height="16"
                width="20"
                viewBox="0 0 640 512"
              >
                <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L472.1 344.7c15.2-26 23.9-56.3 23.9-88.7V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 21.2-5.1 41.1-14.2 58.7L416 300.8V96c0-53-43-96-96-96s-96 43-96 96v54.3L38.8 5.1zm362.5 407l-43.1-33.9C346.1 382 333.3 384 320 384c-70.7 0-128-57.3-128-128v-8.7L144.7 210c-.5 1.9-.7 3.9-.7 6v40c0 89.1 66.2 162.7 152 174.4V464H248c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H344V430.4c20.4-2.8 39.7-9.1 57.3-18.2z" />
              </svg>
            </button>
          </div>
        </div>
      <% end %>
      <%= if @player.type == "admin" and @turn.player.id != @player.id and @turn.state == :pending do %>
        <div class="flex justify-center mb-2">
          <button class="btn-light-red" phx-click="skip">Skip <%= @turn.player.first_name %></button>
        </div>
      <% end %>
      <div class={"flex flex-col relative my-1 justify-center snap-x #{if @round_state == :terminate, do: "sticky bottom-0 rounded-t-xl", else: "max-h-[20vh]"} bg-white w-full"}>
        <%= if @round_state == :terminate do %>
          <div class="text-3xl text-gray-800 w-full text-center font-medium p-2">Round Complete</div>
        <% end %>
        <div class="flex overflow-x-scroll w-full justify-center">
          <%= for turn <- @turns do %>
            <.avatar turn={turn} current_turn={@turn} player={@player} round_state={@round_state} />
          <% end %>
        </div>
      </div>
    </div>
    """
  end

  def card_list(assigns) do
    ~H"""
    <div class="flex justify-center space-1 items-center w-full" id="card-list">
      <%= case @reveal do %>
        <% :first -> %>
          <div class="flex flex-col w-1/2" phx-hook="Swiper" id="deck">
            <div class="swiper deck">
              <div class="swiper-wrapper">
                <img
                  alt={Enum.at(@cards, -1).name}
                  class="swiper-slide h-auto filter drop-shadow-xl shadow-red-200"
                  src={KurtenWeb.Endpoint.static_path("/images/#{Enum.at(@cards, -1).name}.png")}
                  class="w-auto"
                />
                <%= for _card <- Enum.drop(@cards, -1) do %>
                  <img
                    alt="card"
                    class="swiper-slide h-auto filter drop-shadow-xl shadow-red-200"
                    src={KurtenWeb.Endpoint.static_path("/images/blank.png")}
                  />
                <% end %>
              </div>
            </div>
          </div>
        <% :all -> %>
          <div class="flex flex-col w-1/2" phx-hook="Swiper" id="deck">
            <div class="swiper deck">
              <div class="swiper-wrapper">
                <%= for card <- @cards do %>
                  <img
                    alt={card.name}
                    class="swiper-slide h-auto filter drop-shadow-xl shadow-red-200"
                    src={KurtenWeb.Endpoint.static_path("/images/#{card.name}.png")}
                    class="w-auto"
                  />
                <% end %>
              </div>
            </div>
            <.card_thumbnail cards={@cards} />
          </div>
        <% :none -> %>
          <div class="flex flex-col w-1/2" phx-hook="Swiper" id="deck">
            <div class="swiper deck">
              <div class="swiper-wrapper">
                <%= for _card <- @cards do %>
                  <img
                    alt="card"
                    class="swiper-slide h-auto w-1/2 filter drop-shadow-xl shadow-red-200"
                    src={KurtenWeb.Endpoint.static_path("/images/blank.png")}
                    class="w-auto"
                  />
                <% end %>
              </div>
            </div>
          </div>
      <% end %>
    </div>
    """
  end

  def card_thumbnail(assigns) do
    ~H"""
    <div class="flex space-x-1 justify-center items-center mt-3">
      <%= for card <- @cards do %>
        <img
          alt={card.name}
          class="swiper-slide h-auto w-6 filter drop-shadow-xl shadow-red-200"
          src={KurtenWeb.Endpoint.static_path("/images/#{card.name}_thumb.png")}
          class="w-auto"
        />
      <% end %>
    </div>
    """
  end

  def avatar(assigns) do
    ~H"""
    <div class="w-1/4 aspect-square p-1 flex flex-col justify-center align-center items-center snap-start">
      <div class={"h-full w-full flex justify-center align-center items-center flex-col px-1 #{if @turn.player.id == @current_turn.player.id, do: "border rounded-lg border-2 "}"}>
        <button
          phx-click="view_player"
          phx-value-player_id={@turn.player.id}
          class="w-3/5 aspect-square rounded-full bg-gray-100 items-center bg-gray-100 flex justify-center"
        >
          <%= cond do %>
            <% @turn.state == :lost or (@turn.player.type == "admin" and @turn.bet < 0) -> %>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-4 h-4 fill-red-500"
                viewBox="0 0 320 512"
              >
                <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                <path d="M137.4 374.6c12.5 12.5 32.8 12.5 45.3 0l128-128c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8L32 192c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l128 128z" />
              </svg>
              <span class="flex text-red-700 text-center justify-center">
                <%= if @turn.bet < 0 and @turn.player.type != "admin",
                  do: "-#{@turn.bet}",
                  else: @turn.bet %>
              </span>
            <% @turn.player.type == "admin" and @round_state == :playing -> %>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  class="text-gray-600"
                  fill-rule="evenodd"
                  d="M10.496 2.132a1 1 0 00-.992 0l-7 4A1 1 0 003 8v7a1 1 0 100 2h14a1 1 0 100-2V8a1 1 0 00.496-1.868l-7-4zM6 9a1 1 0 00-1 1v3a1 1 0 102 0v-3a1 1 0 00-1-1zm3 1a1 1 0 012 0v3a1 1 0 11-2 0v-3zm5-1a1 1 0 00-1 1v3a1 1 0 102 0v-3a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
            <% @turn.state == :pending -> %>
              <span class="flex text-gray-400	text-center justify-center">
                <div class="snippet" data-title="dot-flashing">
                  <div class="stage">
                    <div class="dot-flashing"></div>
                  </div>
                </div>
              </span>
            <% @turn.state == :skipped -> %>
              <span class="flex text-gray-400	text-center justify-center">ｘ</span>
            <% @turn.state == :won or (@turn.player.type == "admin" and @turn.bet > 0) -> %>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-4 h-4 fill-green-600"
                viewBox="0 0 320 512"
              >
                <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                <path d="M182.6 137.4c-12.5-12.5-32.8-12.5-45.3 0l-128 128c-9.2 9.2-11.9 22.9-6.9 34.9s16.6 19.8 29.6 19.8H288c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-128-128z" />
              </svg>
              <span class="flex text-green-700 text-center justify-center">
                <%= "#{@turn.bet}" %>
              </span>
            <% @turn.state == :standby -> %>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"
                />
              </svg>
              <span class="text-center text-blue-800"><%= "#{@turn.bet}" %></span>
          <% end %>
        </button>
        <div class="flex flex-col text-[10px] max-w-full truncate">
          <%= player_name(@turn.player, @player) %>
        </div>
      </div>
    </div>
    """
  end

  def bet_amount(assigns) do
    ~H"""
    <div>
      <div class="flex justify-center text-gray-800 text-xl flex-col items-center mb-2">
        <span class="w-max text-xs text-gray-600">Bet Amount</span>
        <span class="w-max text-gray-700 font-semibold"><%= @bet + @added_bet %></span>
      </div>
      <div class="flex justify-center mt-auto space-x-2 mb-2">
        <button
          class="rounded-full bg-gray-100 text-gray-600 h-6 w-max px-2 text-xs"
          phx-click="bet_amount"
          phx-value-amount={0}
        >
          <%= @bet %>
        </button>
        <button
          class="rounded-full bg-red-100 text-red-600 w-6 h-6 text-xs"
          phx-click="bet_amount"
          phx-value-amount={@added_bet + 1}
        >
          +1
        </button>
        <button
          class="rounded-full bg-red-100 text-red-600 w-6 h-6 text-xs"
          phx-click="bet_amount"
          phx-value-amount={@added_bet + 5}
        >
          +5
        </button>
        <button
          class="rounded-full bg-red-100 text-red-600 w-6 h-6 text-xs"
          phx-click="bet_amount"
          phx-value-amount={@added_bet + 10}
        >
          +10
        </button>
      </div>
    </div>
    """
  end

  defp player_name(player, viewer) do
    if player.id == viewer.id do
      "You"
    else
      "#{player.first_name} #{player.last_name}"
    end
  end
end
