defmodule KurtenWeb.AuthController do
  use KurtenWeb, :controller
  alias Kurten.Room

  def player_validate(conn, _params) do
    player = get_session(conn, :player_id)
    room = get_session(conn, :room_id)

    if is_binary(player) and is_binary(room) do
      validate_player_and_room(conn, player, room)
    else
      redirect_home(conn)
    end
  end

  def redirect_if_authenticated(conn, _params) do
    with player_id when is_binary(player_id) <- get_session(conn, :player_id),
         room_id when is_binary(room_id) <- get_session(conn, :room_id),
         {:ok, _, _} <- Room.get_info_for_player(room_id, player_id) do
      redirect_room(conn)
    else
      _ -> conn
    end
  end

  defp redirect_room(conn) do
    conn
    |> redirect(to: "/room")
    |> halt
  end

  defp redirect_home(conn) do
    conn
    |> put_flash(:error, "The game does not exist.")
    |> redirect(to: ~p"/")
    |> halt
  end

  defp validate_player_and_room(conn, player_id, room_id) do
    case Room.get_info_for_player(room_id, player_id) do
      {:ok, _, _} -> conn
      _e -> redirect_home(conn)
    end
  end
end
