using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGuestTags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "custom_tags",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    label = table.Column<string>(type: "text", nullable: false),
                    owner_role = table.Column<string>(type: "text", nullable: false),
                    hotel_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_custom_tags", x => x.id);
                    table.ForeignKey(
                        name: "fk_custom_tags_hotels_hotel_id",
                        column: x => x.hotel_id,
                        principalTable: "hotels",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "guest_custom_tags",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    custom_tag_id = table.Column<Guid>(type: "uuid", nullable: false),
                    guest_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    applied_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    applied_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_guest_custom_tags", x => x.id);
                    table.ForeignKey(
                        name: "fk_guest_custom_tags_custom_tags_custom_tag_id",
                        column: x => x.custom_tag_id,
                        principalTable: "custom_tags",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_custom_tags_hotel_id",
                table: "custom_tags",
                column: "hotel_id");

            migrationBuilder.CreateIndex(
                name: "ix_custom_tags_owner_role_hotel_id",
                table: "custom_tags",
                columns: new[] { "owner_role", "hotel_id" });

            migrationBuilder.CreateIndex(
                name: "ix_guest_custom_tags_custom_tag_id_guest_user_id",
                table: "guest_custom_tags",
                columns: new[] { "custom_tag_id", "guest_user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_guest_custom_tags_guest_user_id",
                table: "guest_custom_tags",
                column: "guest_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "guest_custom_tags");

            migrationBuilder.DropTable(
                name: "custom_tags");
        }
    }
}
