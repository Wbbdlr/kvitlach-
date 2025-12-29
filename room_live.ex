defmodule KurtenWeb.RoomLive do
  use KurtenWeb, :live_view
  alias Kurten.Room
  alias Phoenix.PubSub
  alias KurtenWeb.Presence

  @moduledoc """
    pages.
    index. lets you create and join a room
    room. lists room participants
    round. playing the round
  """

  @impl true
  def mount(_params, session, socket) do
    case Room.get_info_for_player(session["room_id"], session["player_id"]) do
      {:ok, room, player} ->
        PubSub.subscribe(Kurten.PubSub, "room:#{session["room_id"]}")
        Presence.track(self(), "presence:#{session["room_id"]}", session["player_id"], %{})
        {:ok, assign(socket, player: player, room: room, room_id: room.room_id)}

      _e ->
        {:ok, redirect(socket, to: "/")}
    end
  end

  @impl true
  def handle_event("start_round", _params, socket) do
    Room.start_round(socket.assigns.room.room_id)
    {:noreply, socket}
  end

  @impl true
  def handle_event("join_round", _params, socket) do
    {:noreply, push_navigate(socket, to: "/round")}
  end

  def handle_event("set_admin", %{"player_id" => player_id}, socket) do
    Room.switch_admin(socket.assigns.room.room_id, player_id)
    {:noreply, socket}
  end

  def handle_event("leave_room", _params, socket) do
    Room.leave(socket.assigns.room.room_id, socket.assigns.player.id)
    {:noreply, redirect(socket, to: "/")}
  end

  def handle_event("terminate_room", _params, socket) do
    Room.terminate_room(socket.assigns.room.room_id)
    {:noreply, socket}
  end

  @impl true
  def handle_info(:round_started, socket) do
    {:noreply, push_navigate(socket, to: "/round")}
  end

  @impl true
  def handle_info([players: players], socket) do
    {:noreply, assign(socket, :room, Map.put(socket.assigns.room, :players, players))}
  end

  @impl true
  def handle_info({:room_terminated, :inactivity_timeout}, socket) do
    {:noreply,
      socket
      |> put_flash(:info, "Room closed due to inactivity")
      |> redirect(to: "/")}
  end

  @impl true
  def handle_info({:room_terminated, :admin_terminated}, socket) do
    {:noreply,
      socket
      |> put_flash(:info, "Room closed by admin")
      |> redirect(to: "/")}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="w-full h-full">
      <div class="flex flex-col p-4 h-full">
        <div class="text-center">
          Hello <%= @player.first_name %>
        </div>
        <div class="text-center mt-1 mb-2 text-xs text-gray-500">
          The bank can start the round.
        </div>

        <div class="flex flex-wrap w-full overflow-scroll">
          <%= for player <- @room.players  do %>
            <.avatar
              player={player}
              balance={get_balance(player, @room.balances)}
              current_player={@player}
            />
          <% end %>
        </div>
        <div x-data class="flex-col mt-auto justify-center w-full border-t-1 border-gray-500 relative">
          <div phx-hook="VoiceCall" id="voice_call" data-view="room">
            <button
              id="toggle-mute"
              phx-update="ignore"
              class="absolute -top-16 select-none right-0 rounded-full w-12 h-12 text-center flex align-center justify-center items-center bg-gray-100 border shadow-xl"
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
                class="bg-white hidden"
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
          <hr />
          <div class="flex text-center justify-center text-lg text-gray-800 p-4">
            <span>Invite your friends to join the game.</span>
          </div>
          <div class="flex justify-center w-full mb-4">
            <div
              @click={"window.open('whatsapp://send?text=#{whatsapp_message(@player, @room.room_id)}')"}
              class="flex flex-col m-4 items-center text-center w-1/2"
            >
              <div class="flex bg-white w-max justify-center border border-1 rounded-full p-2 hover:bg-gray-100 border-gray-300 border-1 shadow-md">
                <a type="button">
                  <img
                    class="h-6 w-auto"
                    src="https://cdn2.iconfinder.com/data/icons/social-messaging-ui-color-shapes-2-free/128/social-whatsapp-circle-512.png"
                  />
                </a>
              </div>
              <span class="p-2 text-sm text-gray-600">Share on Whatsapp</span>
            </div>
            <div x-data class="flex flex-col m-4 items-center text-center w-1/2">
              <div
                @click={"copied = true; navigator.clipboard.writeText('#{url(@room.room_id)}')"}
                class="flex bg-white w-max justify-center border border-1 rounded-full p-2 hover:bg-gray-100 border-gray-300 border-1 shadow-md"
              >
                <a id="copy_invite" type="button">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="w-6 h-6"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
                    />
                  </svg>
                </a>
              </div>
              <span class="p-2 text-sm text-gray-600">Copy Invite Link</span>
            </div>
          </div>
        </div>
        <div class="flex flex-col space-y-1">
          <%= if not is_nil(@room.round_id) do %>
            <button class="btn-light-red" phx-click="join_round">View round in progress</button>
          <% end %>
          <%= if @player.type == "admin" do %>
            <%= if length(@room.players) > 1 and is_nil(@room.round_id) do %>
              <button
                class="btn-light-red border border-red-200 shadow rounded-full"
                phx-click="start_round"
              >
                Start Round
              </button>
            <% end %>
            <button
              class="btn-light-red border border-red-200 shadow rounded-full"
              phx-click="terminate_room"
              data-confirm="Are you sure you want to end this game? This action cannot be undone."
            >
              End Game
            </button>
          <% end %>
        </div>
      </div>
    </div>
    """
  end

  def url(room_id) do
    "#{System.get_env("PHX_HOST") || "http://localhost:4000"}/join/#{room_id}"
  end

  defp whatsapp_message(player, room_id) do
    "#{player.first_name} #{player.last_name} is inviting you to to join kvitlech game. #{url(room_id)}"
  end

  defp get_balance(player, balances) do
    user_balances =
      Enum.filter(balances, fn balance ->
        balance.payee == player.id or balance.payer == player.id
      end)

    Enum.reduce(user_balances, 0, fn balance, acc ->
      if balance.payee == player.id do
        acc + balance.amount
      else
        acc - balance.amount
      end
    end)
  end

  def avatar(assigns) do
    ~H"""
    <div class="flex w-32 h-64 py-4 px-1 justify-center">
      <div class="flex flex-col justify-start items-center">
        <div class="relative">
          <%= if assigns.player.type == "admin" do %>
            <div class="h-20 w-20 rounded-full bg-gray-100 flex items-center align-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-10 w-10"
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
            </div>
            <span class={"absolute bottom-0 right-2 inline-block w-3 h-3 #{if assigns.player.presence == "online", do: "bg-green-600", else: "bg-gray-400"} border-2 border-white rounded-full"}>
            </span>
          <% else %>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-20 w-20"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                class="text-gray-200"
                fill-rule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z"
                clip-rule="evenodd"
              />
            </svg>
            <span class={"absolute bottom-2 right-3 inline-block w-3 h-3 #{if assigns.player.presence == "online", do: "bg-green-600", else: "bg-gray-400"} border-2 border-white rounded-full"}>
            </span>
          <% end %>
        </div>
        <div class="text-center whitespace-nowrap truncate w-4/5 px-3">
          <%= if assigns.player.id == assigns.current_player.id do %>
            You
          <% else %>
            <%= assigns.player.first_name %> <%= assigns.player.last_name %>
          <% end %>
        </div>
        <div class="text-center truncate w-4/5 flex items-center align-center justify-center">
          <%= cond do %>
            <% @balance > 0 -> %>
              <span class="text-green-600 text-center flex items-center align-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-4 h-4 fill-green-600"
                  viewBox="0 0 320 512"
                >
                  <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                  <path d="M182.6 137.4c-12.5-12.5-32.8-12.5-45.3 0l-128 128c-9.2 9.2-11.9 22.9-6.9 34.9s16.6 19.8 29.6 19.8H288c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-128-128z" />
                </svg>
                <%= @balance %>
              </span>
            <% @balance == 0 -> %>
              <span class="text-gray-500">
                <%= @balance %>
              </span>
            <% @balance < 0 -> %>
              <span class="text-red-500 text-center flex items-center align-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-4 h-4 fill-red-500"
                  viewBox="0 0 320 512"
                >
                  <!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->
                  <path d="M137.4 374.6c12.5 12.5 32.8 12.5 45.3 0l128-128c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8L32 192c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l128 128z" />
                </svg>
                <%= @balance %>
              </span>
          <% end %>
        </div>
        <%= if assigns.current_player.type == "admin" and assigns.player.type != "admin" do %>
          <div class="text-center truncate w-4/5">
            <button
              phx-click="set_admin"
              phx-value-player_id={assigns.player.id}
              class="text-red-500 background-transparent uppercase px-3 py-1 text-xs  mr-1 mb-1 "
              type="button"
            >
              set <%= assigns.player.first_name %> as bank
            </button>
          </div>
        <% end %>
      </div>
    </div>
    """
  end
end
