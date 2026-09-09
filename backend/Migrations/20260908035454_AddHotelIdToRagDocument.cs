using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHotelIdToRagDocument : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "hotel_id",
                table: "rag_documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_rag_documents_hotel_id",
                table: "rag_documents",
                column: "hotel_id");

            migrationBuilder.AddForeignKey(
                name: "fk_rag_documents_hotels_hotel_id",
                table: "rag_documents",
                column: "hotel_id",
                principalTable: "hotels",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_rag_documents_hotels_hotel_id",
                table: "rag_documents");

            migrationBuilder.DropIndex(
                name: "ix_rag_documents_hotel_id",
                table: "rag_documents");

            migrationBuilder.DropColumn(
                name: "hotel_id",
                table: "rag_documents");
        }
    }
}
