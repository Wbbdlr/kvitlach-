defmodule KurtenWeb.AdminLive do
  use KurtenWeb, :live_view
  require Logger

  @moduledoc """
    pages.
    index. lets you create and join a room
    room. lists room participants
    round. playing the round
  """

  @impl true
  def mount(_params, _session, socket) do
    children = DynamicSupervisor.which_children(Kurten.RoomSupervisor)

    rooms =
      for {_, pid, _, _} <- children do
        room = get_room_info(pid)
        Map.put(room, :players, with_balance(room.players, room.balances))
      end

    {:ok, assign(socket, rooms: rooms, room_id: "", player: %{id: ""})}
  end

  def get_room_info(pid) do
    try do
      GenServer.call(pid, :room)
    catch
      :exit, _ -> {:error, :not_found}
    end
  end

  defp with_balance(players, balances) do
    #    players as map
    Logger.info("players: #{inspect(players)}")

    players =
      Enum.map(players, fn %{id: id} = player -> {id, Map.from_struct(player)} end)
      |> Enum.into(%{})

    #  add balance to each payer
    Enum.reduce(balances, players, fn b, players ->
      payee =
        Map.put(players[b.payee] || %{}, :balance, (players[b.payee][:balance] || 0) + b.amount)

      payer =
        Map.put(players[b.payer] || %{}, :balance, (players[b.payer][:balance] || 0) - b.amount)

      Map.put(players, payee[:id] || "yank", payee)
      |> Map.put(payer[:id] || "bla", payer)
    end)
    |> Enum.map(fn {_, player} -> player end)
  end

  #  def handle_event("leave_room", _params, socket) do
  #    Room.leave(socket.assigns.room.room_id, socket.assigns.player.id)
  #    {:noreply, push_redirect(socket, to: "/")}
  #  end
  #
  #  @impl true
  #  def handle_info(:round_started, socket) do
  #    {:noreply, push_redirect(socket, to: "/round")}
  #  end
  #
  #  @impl true
  #  def handle_info([players: players], socket) do
  #    {:noreply, assign(socket, :room, Map.put(socket.assigns.room, :players, players))}
  #  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="p-2">
      <%= for room <- @rooms do %>
        <div class="mt-20"><%= room.room_id %></div>
        <table class="table-auto border-collapse border m-2 w-auto">
          <thead>
            <tr>
              <th class="border p-2">First Name</th>
              <th class="border p-2">Last Name</th>
              <th class="border p-2">Presence</th>
              <th class="border p-2">Balance</th>
            </tr>
          </thead>
          <tbody>
            <%= for player <- room.players do %>
              <tr>
                <td class="border p-2"><%= player[:first_name] %></td>
                <td class="border p-2"><%= player[:last_name] %></td>
                <td class="border p-2"><%= player[:presence] %></td>
                <td class="border p-2"><%= player[:balance] %></td>
              </tr>
            <% end %>
          </tbody>
        </table>
      <% end %>
    </div>
    """
  end
end
