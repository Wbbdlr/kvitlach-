defmodule KurtenWeb.Router do
  use KurtenWeb, :router
  import KurtenWeb.AuthController

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {KurtenWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", KurtenWeb do
    pipe_through [:browser, :redirect_if_authenticated]
    #   redirect if authorized
    get "/", HomeController, :index
    get "/join", PlayerController, :new
    post "/create", PlayerController, :create
    post "/join/:room_id", PlayerController, :join
  end

  scope "/", KurtenWeb do
    pipe_through [:browser]
    get "/join/:room_id", PlayerController, :new
  end

  scope "/", KurtenWeb do
    pipe_through [:browser, :player_validate]
    live "/room", RoomLive
    live "/round", RoundLive
  end

  scope "/", KurtenWeb do
    pipe_through [:browser]
    live "/admin", AdminLive, :index
  end

  # Other scopes may use custom stacks.
  # scope "/api", KurtenWeb do
  #   pipe_through :api
  # end

  # Enables LiveDashboard only for development
  #
  # If you want to use the LiveDashboard in production, you should put
  # it behind authentication and allow only admins to access it.
  # If your application does not have an admins-only section yet,
  # you can use Plug.BasicAuth to set up some basic authentication
  # as long as you are also using SSL (which you should anyway).
  if Mix.env() in [:dev, :test] do
    import Phoenix.LiveDashboard.Router

    scope "/" do
      pipe_through :browser
      live_dashboard "/dashboard", metrics: KurtenWeb.Telemetry
    end
  end
end
