defmodule KurtenWeb.PlayerController do
  use KurtenWeb, :controller
  alias Kurten.Player
  alias Kurten.Room

  def new(conn, %{"room_id" => room_id} = params) do
    changeset = Player.changeset(%{})

    with player_id when is_binary(player_id) <- get_session(conn, :player_id),
         {:ok, room} <- Room.get_info(room_id),
         existing_room_id <- get_session(conn, :room_id),
         {:ok, room, _} <- Room.get_info_for_player(existing_room_id, player_id) do
      if room_id != existing_room_id do
        render(conn, :new, changeset: changeset, room: room, switch: true)
      else
        conn
        |> redirect(to: "/room")
      end
    else
      _ ->
        case Room.get_info(room_id) do
          {:ok, room} -> render(conn, :new, changeset: changeset, room: room, switch: false)
          {:error, _} -> redirect_home(conn)
        end
    end
  end

  def new(conn, _params) do
    changeset = Player.changeset(%{})
    render(conn, :new, changeset: changeset, room: nil, switch: false)
  end

  #  create new room
  def create(conn, %{"player" => params}) do
    {:ok, room_id, player} = Player.create(params)

    conn
    |> put_session(:player_id, player.id)
    |> put_session(:room_id, room_id)
    |> redirect(to: "/room")
  end

  #  join existing room
  def join(conn, %{"player" => player} = params) do
    {:ok, room, player} = Player.create(player, params["room_id"])

    conn
    |> put_session(:player_id, player.id)
    |> put_session(:room_id, room.room_id)
    |> redirect(to: "/room")
  end

  defp redirect_home(conn) do
    conn
    |> put_flash(:error, "The game does not exist. Create a new game.")
    |> redirect(to: ~p"/")
    |> halt
  end
end
