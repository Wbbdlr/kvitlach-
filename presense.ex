defmodule KurtenWeb.Presence do
  use Phoenix.Presence,
    otp_app: :kurten,
    pubsub_server: Kurten.PubSub
end
