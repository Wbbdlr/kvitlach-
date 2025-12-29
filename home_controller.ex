defmodule KurtenWeb.HomeController do
  use KurtenWeb, :controller
  #  plug to reroute if authenticated
  # should reroute to /room. round will have a button to get into the round

  def index(conn, _params) do
    render(conn, "home.html", [])
  end
end
