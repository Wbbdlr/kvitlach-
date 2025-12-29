defmodule Kurten.Deck do
  @cards [
    %{name: "1", attributes: %{values: [1]}},
    %{name: "2", attributes: %{values: [2], type: "rosier"}},
    %{name: "3", attributes: %{values: [3]}},
    %{name: "4", attributes: %{values: [4]}},
    %{name: "5", attributes: %{values: [5]}},
    %{name: "6", attributes: %{values: [6]}},
    %{name: "7", attributes: %{values: [7]}},
    %{name: "8", attributes: %{values: [8]}},
    %{name: "9", attributes: %{values: [9]}},
    %{name: "10", attributes: %{values: [10]}},
    %{name: "11", attributes: %{values: [11], type: "rosier"}},
    %{name: "12", attributes: %{values: [12, 9, 10]}}
  ]

  def new do
    Enum.reduce(@cards, [], fn x, acc -> acc ++ Enum.map(1..4, fn _ -> x end) end)
    |> Enum.shuffle()
    |> IO.inspect(label: "shuffled")
  end
end
