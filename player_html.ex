defmodule KurtenWeb.PlayerHTML do
  use KurtenWeb, :html

  #  embed_templates "player_html/*"

  def new(assigns) do
    ~H"""
    <div class="flex align-center w-full justify-center mt-10">
      <%= if @switch do %>
        <.modal show={true} id="room_exists">
          <div>You are already in a game. Do you want to switch?</div>
          <div class="flex justify-end mt-10 p-2">
            <button phx-click={JS.navigate("/room")} class="btn-light-red ml-2  rounded-full ">
              Back to room
            </button>
          </div>
        </.modal>
      <% end %>
      <img
        alt="card"
        class="-rotate-6 h-auto w-14 filter drop-shadow-xl shadow-red-200"
        src={KurtenWeb.Endpoint.static_path("/images/11.png")}
        class="w-auto"
      />
      <img
        alt="card"
        class="rotate-6	 h-auto w-14 filter drop-shadow-xl shadow-red-200"
        src={KurtenWeb.Endpoint.static_path("/images/9.png")}
        class="w-auto"
      />
    </div>
    <header class="flex justify-center text-4xl text-center h-16 mt-3">
      <div class="p-1 w-full">
        <span class="text-2xl text-light" style="font-family: 'Suez One'">קוויטלעך</span>
      </div>
    </header>

    <div class="flex justify-center mt-20 text-xl font-thin	 text-gray-700 px-20">
      <%= if not is_nil(@room) do %>
        <%= Enum.find(@room.players, &(&1.type == "admin")).first_name %> invited you to join the game
      <% else %>
        Create a game
      <% end %>
    </div>

    <.form
      :let={f}
      class="mt-10"
      for={@changeset}
      action={if is_nil(@room), do: ~p"/create", else: ~p"/join/#{@room}"}
    >
      <div class="flex flex-col">
        <div class=" flex flex-col items-center justify-center px-2">
          <div class="mb-4 w-2/3">
            <.input
              label="First Name"
              class="w-full shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-3 leading-tight focus:outline-none focus:shadow-outline"
              field={f[:first_name]}
              placeholder="First Name"
              required="true"
            />
          </div>
          <div class="mb-6 w-2/3">
            <.input
              label="Last Name"
              class="w-full shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              field={f[:last_name]}
              placeholder="Last Name"
              required="true"
            />
          </div>
          <button type="submit" class="btn-light-red w-1/2 mt-20  rounded-full ">Submit</button>
        </div>
      </div>
    </.form>
    """
  end
end
